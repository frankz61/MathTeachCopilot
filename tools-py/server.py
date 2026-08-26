"""MathTeachCopilot 工具层 —— MCP stdio server。

由 Electron 主进程作为子进程拉起，Agent SDK 通过 MCP 调用这里的工具。
工具名在 Agent 侧形如 mcp__mathtools__verify_algebra。

第一版刻意只有一个 server。拆成题库/绘图/排版/学情四个是以后的事，
理由不是性能而是复杂度——见 docs/architecture.md 第四节。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any, Literal

# 自己把所在目录放进 sys.path，不要指望解释器帮忙。
#
# 平时 `python server.py` 会自动把脚本目录加进 sys.path[0]，但**随包分发的
# embeddable Python 不会**：它带一个 ._pth 文件，一旦存在，sys.path 就完全由
# 那个文件决定，脚本目录不再自动加入。结果是开发期一切正常、打包后
# `ModuleNotFoundError: No module named 'mathtools'`——而这个错只会出现在
# 老师的机器上，表现成「数学工具进程未连上」。
sys.path.insert(0, str(Path(__file__).resolve().parent))

from mcp.server.mcpserver import MCPServer

from mathtools import charts as charts_mod
from mathtools import curriculum as curriculum_mod
from mathtools import export as export_mod
from mathtools import figure as figure_mod
from mathtools import geometry as geometry_mod
from mathtools import illustration as illustration_mod
from mathtools import store as store_mod
from mathtools import verify as verify_mod

def _maybe_start_debugger() -> None:
    """可选调试钩子。

    工具进程是被 Electron 当子进程拉起来的，没法从 VS Code 直接「启动并调试」，
    只能反过来让它监听、由调试器附加上来。

      MTC_DEBUGPY=1     监听 5679 但不阻塞（推荐；随时可附加）
      MTC_DEBUGPY=wait  等调试器附加上再继续。注意 MCP 握手默认 30 秒超时，
                        用这个模式要同时把 MCP_TIMEOUT 调大，否则客户端会先放弃。

    打包后 debugpy 不存在，import 失败静默跳过即可。
    """
    mode = os.environ.get("MTC_DEBUGPY", "").strip().lower()
    if not mode:
        return
    # 这条校验只会刷屏警告，对我们自己模块里的断点没影响
    os.environ.setdefault("PYDEVD_DISABLE_FILE_VALIDATION", "1")
    try:
        import debugpy  # 只在开发期存在
    except ImportError:
        return
    port = int(os.environ.get("MTC_DEBUGPY_PORT", "5679"))
    try:
        debugpy.listen(("127.0.0.1", port))
    except Exception:
        return  # 端口被占（比如上一个进程没退干净），不影响正常工作
    if mode == "wait":
        debugpy.wait_for_client()


server = MCPServer("mathtools")


@server.tool()
def lookup_curriculum(
    ids: list[str] | None = None, query: str = "", limit: int = 12
) -> dict[str, Any]:
    """查教材知识点。**出题前必须先查清 meta.json 里 standardRefs 的每个 id 是什么。**

    你的工作目录是课时文件夹，里面只有 meta.json 和 problems.json，
    教材数据不在那儿——只能通过这个工具查，不要用 Read/Glob 到处翻，翻不到的。

    两种用法，可以同时给：

      ids   ["tp-27-03"]     按 id 精确查，用于解析 meta.json 里的 standardRefs
      query "一元二次方程"     按关键词搜，用于找相关或前置知识点

    返回每个知识点的：所属教材 / 年级 / 章、内容摘要、中考权重、
    常见错因、前置知识点 id。

    - **常见错因**是出题的好素材：可以刻意命中（让学生踩一次坑）或刻意规避。
    - **中考权重** high 的知识点值得多出题。
    - 查不到的 id 会列在 missing 里——**那就别编**，改用 query 搜，
      或者直接告诉老师这个知识点没有数据。
    """
    return curriculum_mod.lookup(ids or [], query, limit)


@server.tool()
def verify_algebra(
    kind: Literal["solve", "identity", "evaluate"],
    variable: str = "x",
    equation: str = "",
    claimed_roots: list[str] | None = None,
    left: str = "",
    right: str = "",
    expression: str = "",
    substitutions: dict[str, str] | None = None,
    claimed: str = "",
) -> dict[str, Any]:
    """用 CAS 验证一道代数题的答案是否正确。每道代数题写入 problems.json 前都必须调用。

    每次验证都会走两条互相独立的路径，两条都通过才返回 green。返回的整个对象
    应原样写进题目的 verify 字段，不要改写、不要自己编造。

    三种用法：

    - kind="solve"：验证方程的解。需要 equation（如 "x^2 - 5*x + 6 = 0"）、
      variable、claimed_roots（如 ["2", "3"]）。
      两条路径 = 独立求解比对解集 + 把声称的根代回原式看是否为 0。

    - kind="identity"：验证恒等变形，用于化简题和因式分解题。需要 left、right
      （如 left="x^2-4", right="(x+2)*(x-2)"）。
      两条路径 = 符号化简差为 0 + 随机代值数值复核。

    - kind="evaluate"：验证求值。需要 expression、substitutions（如 {"x": "3"}）、claimed。

    表达式用 sympy 语法，允许用 ^ 表示乘方。

    返回 status 为 red 时**不要**把这道题写进 problems.json——修正后重验，
    仍然不过就换一道题。log 字段说明了哪条路径失败以及为什么。
    """
    if kind == "solve":
        if not equation or not claimed_roots:
            return {
                "status": "red",
                "log": "kind=solve 需要同时提供 equation 和 claimed_roots",
                "paths": [],
            }
        return verify_mod.verify_solve(equation, variable, claimed_roots).to_dict()

    if kind == "identity":
        if not left or not right:
            return {"status": "red", "log": "kind=identity 需要同时提供 left 和 right", "paths": []}
        return verify_mod.verify_identity(left, right).to_dict()

    if kind == "evaluate":
        if not expression or not claimed:
            return {
                "status": "red",
                "log": "kind=evaluate 需要同时提供 expression 和 claimed",
                "paths": [],
            }
        return verify_mod.verify_evaluate(expression, substitutions or {}, claimed).to_dict()

    return {"status": "red", "log": f"未知的 kind：{kind}", "paths": []}


@server.tool()
def verify_answer_shape(equation: str, variable: str = "x") -> dict[str, Any]:
    """检查一道方程题的答案「好不好看」，用于出题后的专业度自检。

    这不是对错检查（对错走 verify_algebra），是教学适配性检查。老师判断一道题
    专不专业，第一眼看的就是答案干不干净：整数解、判别式为完全平方、比例能约干净。
    出现 x = 7/13 这类答案，题目在数学上没错，但没有教学意义。

    返回 ok=false 时，按 issues 里的提示反向调整系数重新出题，不要把丑答案留给老师。
    facts 里带回了判别式、根、次数等信息，可用来指导调整方向。
    """
    return verify_mod.check_answer_shape(equation, variable)


@server.tool()
def save_problems(
    problems: list[dict[str, Any]], out_path: str, mode: str = "replace"
) -> dict[str, Any]:
    r"""把题目写进 problems.json。**这是写这个文件的唯一方式**，不要用 Write 工具去写它。

    两个原因：手写含 LaTeX 的 JSON（$\Delta$ 要写成 \\Delta）几乎必然出错；
    而且验证结果不能由你填——那样等于自己给自己发合格证。

    每道题传这些字段：

      id            本课时内唯一
      stem          题干，Markdown + LaTeX，行内公式用 $...$
      answer        答案
      solution      **分步解析，字符串数组，一步一项**，至少 2 步。不要写成一整段
      tier          "A" | "B" | "C"
      type          "选择" | "填空" | "解答" | "证明" | "作图"
                    **默认要混着出**，不要一整卷都是解答题
      options       选择题的选项 {"A": "...", "B": "...", ...}，非选择题不传。
                    **选项不要重复写进 stem**，写了会被拒收——界面和 Word 里会各有两份
      knowledgePointIds  课标知识点 ID 数组
      figureRefs    引用的图，如 ["assets/f1.svg"]，没有就传 []
      variantSeed   **对象** {template, params, constraints}，同源换数的种子
      check         这道题该怎么验，见下

    check 决定验算怎么跑，由本工具执行，结果直接写进 verify 字段：

      {"kind": "solve",    "equation": "x^2-5*x+6=0", "variable": "x",
       "claimed_roots": ["2", "3"]}
      {"kind": "identity", "left": "x^2-4", "right": "(x+2)*(x-2)"}
      {"kind": "evaluate", "expression": "x^2+3*x", "substitutions": {"x": "4"},
       "claimed": "28"}
      {"kind": "manual",   "reason": "实际意义判断，检查器覆盖不到"}

    **选择题用单独一档**（type="选择" 时必须用它）：

      {"kind": "choice", "correct": "B",
       "basis": {"kind": "solve", "equation": "x^2-4*x+4=0", "variable": "x",
                 "claimed_roots": ["2"]}}

    选项从题目的 options 字段读，不在 check 里重复存。basis 说明正确答案怎么算出来：
    给 solve/identity/evaluate 就能验成绿色；概念判断、命题真假这类给
    {"kind": "manual", "reason": "..."}，只能到黄色。

    「下列…中，正确的是」这一族里，**选项本身是待判的式子**，不是候选答案。
    这时在 basis 里用 {option} 占位，工具会把每个选项代进去逐个跑：

      {"kind": "choice", "correct": "A",
       "basis": {"kind": "solve", "equation": "{option}", "variable": "x",
                 "claimed_roots": ["2"]}}      # 下列方程中解为 x=2 的是
      {"kind": "choice", "correct": "A",
       "basis": {"kind": "identity", "left": "{option}", "right": "x^2-4"}}
                                               # 下列与 x^2-4 相等的是

    占位符要独占整个字段，不要写成 "({option})"——选项常自带等号，套括号会解析不了。

    选择题会验三条：选项两两互异、正确选项确实成立、**其余选项确实都不成立**。
    第三条是选择题最容易出的硬伤——"$x=2$ 或 $x=3$" 和 "$x=3$ 或 $x=2$" 是同一个答案，
    会被判成两个正确选项而拒收。干扰项要真的错，不能只是看起来不一样。

    manual 只用于几何、开放题、证明题、需要判断实际意义的应用题，
    结果一律是黄色（仅教师预览）。不要为了让**代数题**通过而把它标成 manual；
    但证明题、几何题用 manual 是正当的，不要为了凑绿色而回避这些题型。

    **mode**：
      "replace"（默认）整体覆盖 problems.json
      "append"   保留已有的题，只把新题接在后面 —— 出变式、补题都用这个

    **一次别提交太多。** 3 道题的参数就可能被截断，导致整轮重来。
    2 道一批、用 append 连续提交，比一次性交 6 道更快也更稳。

    验算不过的题会被直接拒收、不写盘，并在 rejected 里告诉你原因——
    改题或改答案后重新提交，仍然不过就换一道。
    结构有问题会在 errors 里逐条指出，照着改再提交即可。
    """
    return store_mod.save_problems(problems, out_path, mode)


@server.tool()
def render_figure(
    kind: Literal["function", "number_line", "geometry", "bar", "line", "pie", "histogram"],
    out_path: str,
    expression: str = "",
    variable: str = "x",
    x_min: float = -10.0,
    x_max: float = 10.0,
    title: str = "",
    points: list[dict[str, Any]] | None = None,
    geo_points: dict[str, list[float]] | None = None,
    segments: list[list[str]] | None = None,
    circles: list[dict[str, Any]] | None = None,
    labels: list[dict[str, Any]] | None = None,
    right_angles: list[dict[str, Any]] | None = None,
    asserts: list[dict[str, Any]] | None = None,
    categories: list[str] | None = None,
    values: list[float] | None = None,
    x_label: str = "",
    y_label: str = "",
    bin_edges: list[float] | None = None,
    assert_total: float | None = None,
) -> dict[str, Any]:
    """生成插图并保存为 SVG，返回可写进题干的相对路径。

    只接受结构化参数，不接受自然语言的图形描述——因为模型描述的图和实际画出来的
    图对不上，是几何/函数题最典型的翻车方式。图必须和题干条件同源：画图用的
    expression 必须就是题干里那个表达式。

    - kind="function"：函数图象。需要 expression、variable、x_min、x_max。
    - kind="number_line"：数轴。需要 points，形如
      [{"value": 2, "label": "a", "filled": true}]，filled=false 表示空心点。
    **统计图（条形/折线/扇形/直方图）一律用下面这几种，绝对不要用 geometry 去凑。**
    几何渲染器会给每个点标名字（△ABC 需要标 A、B、C），拿它画条形图会得到一堆
    B2、B3、F2 之类的点名，没有坐标轴、没有类别名、没有数值——学生读不了那种图。

    - kind="bar"：条形统计图。需要 categories（类别名，如 ["篮球","足球"]）、values（各项数值）、
      y_label（如 "人数"）。数值会自动标在柱顶。
    - kind="line"：折线统计图。同样用 categories（如 ["1月","2月"]）和 values。
    - kind="pie"：扇形统计图。用 categories 和 values，自动算百分比。
    - kind="histogram"：频数分布直方图。用 bin_edges（组界，比 values 多一个）和 values。

    统计图可以给 assert_total：题干说「全班共 40 人」就填 40，本工具会核对
    各项之和是否等于它，对不上直接报错——避免画出一张和题干自相矛盾的图。

    - kind="function"：函数图象。需要 expression、variable、x_min、x_max。
    - kind="number_line"：数轴。需要 points。
    - kind="geometry"：几何图形。需要 geo_points（点名 → 坐标），可选：

        segments      [["A","B"], ["B","C"]]                 连线
        circles       [{"center": "O", "radius": 2}]         或 {"center":"O","through":"A"}
        labels        [{"on": ["A","C"], "text": "3"}]       边上的标注
        right_angles  [{"at": "C", "rays": ["A","B"]}]       直角标记

      这四个的形状写错会被忽略（图照出，只是少了那一项），返回值里的 ignored
      会列出来——看到 ignored 就说明有标注没画上，按上面的形状改了重出一次。

      **几何图必须给 asserts**，把题干里的每个条件写成一条，本工具会按坐标实算校验：

        {"type": "length",       "of": ["A","B"], "equals": 4}
        {"type": "angle",        "at": "C", "rays": ["A","B"], "equals": 90}
        {"type": "parallel",     "of": [["A","B"], ["C","D"]]}
        {"type": "equal_length", "of": [["A","B"], ["C","D"]]}
        {"type": "collinear",    "of": ["A","B","C"]}

      对不上就拒绝出图，并告诉你差多少。**不要靠删 asserts 来蒙混过关**——
      题干写「∠C=90°」画出来却是钝角，学生照图量只会越量越错。
      正确做法是调整坐标去满足条件。

    out_path 请写成课时目录下的 assets/xxx.svg，然后在题干里用 ![](assets/xxx.svg) 引用，
    并把同样的路径加进该题的 figureRefs。
    """
    if kind == "function":
        if not expression:
            return {"ok": False, "error": "kind=function 需要 expression"}
        return figure_mod.plot_function(
            expression, variable, (x_min, x_max), out_path, title or None
        )
    if kind == "number_line":
        return figure_mod.plot_number_line(points or [], out_path)
    if kind in ("bar", "line", "pie", "histogram"):
        if kind == "histogram":
            if not bin_edges or not values:
                return {"ok": False, "error": "kind=histogram 需要 bin_edges 和 values"}
            return charts_mod.histogram(
                bin_edges, values, out_path, x_label, y_label or "频数", title
            )
        if not categories or not values:
            return {"ok": False, "error": f"kind={kind} 需要 categories 和 values"}
        if kind == "bar":
            return charts_mod.bar(
                categories, values, out_path, x_label, y_label, title, True, assert_total
            )
        if kind == "line":
            return charts_mod.line(
                categories, values, out_path, x_label, y_label, title, True, assert_total
            )
        return charts_mod.pie(categories, values, out_path, title, True, assert_total)

    if kind == "geometry":
        if not geo_points:
            return {"ok": False, "error": "kind=geometry 需要 geo_points"}
        return geometry_mod.render(
            geo_points, segments, circles, labels, right_angles, asserts, out_path, title
        )
    return {"ok": False, "error": f"未知的 kind：{kind}"}


@server.tool()
def render_illustration(
    prompt: str,
    out_path: str,
    size: Literal["1024x1024", "1024x1536", "1536x1024"] = "1024x1024",
    model: str = "",
) -> dict[str, Any]:
    """生成应用题的**情境插图**（生活场景），保存为 PNG。

    这个工具和 render_figure 分工相反，别搞混：

    | | render_figure | render_illustration（本工具） |
    |---|---|---|
    | 画什么 | 题干的一部分：几何图、函数图象、数轴、统计图 | 生活场景：买菜、行程、储蓄罐、排队 |
    | 怎么画 | 你给坐标/表达式/数值，代码确定性地画 | 你给一句话描述，生图模型画 |
    | 学生会不会去量它 | **会** | 不会 |
    | 画错了能否发现 | 能，asserts 实算校验 | **不能** |

    **凡是学生会去量、去读数的东西，一律走 render_figure。**
    生图模型给不出坐标，asserts 那套校验没有输入：题干写 ∠C=90° 它画成 87°，
    没有任何机制能发现，学生拿尺子照着量只会越量越错。
    本工具会挡掉带几何量/数据的描述，并告诉你该改用哪个 kind——
    那不是提示，是拒绝，换个说法绕过去等于把错图发给学生。

    什么时候值得用它：应用题需要一张场景图帮助理解题意（低年级、阅读量大的题），
    或者课件封面。**大多数题不需要插图，不确定就不要加**——
    可有可无的插图只会让卷子变花、打印变慢。

    prompt 写清画面内容即可，不用写画风（工具会追加"简洁黑白线描、不出现文字"）。
    **不要指望图里的文字**——不是因为它写不出中文（实测中文标签能写对），
    而是写对写错你无从判断，要标注就写在题干里。

    out_path 写成课时目录下的 assets/xxx.png，然后在题干里用 ![](assets/xxx.png)
    引用，并把同样的路径加进该题的 figureRefs——和 render_figure 一样的规矩。

    出一张约 40 秒，比其他工具慢一个量级，别连着调好几次。
    """
    return illustration_mod.generate(prompt, out_path, size=size, model=model)


@server.tool()
def export_docx(
    problems: list[dict[str, Any]],
    out_path: str,
    title: str = "分层作业",
    with_answers: bool = True,
    resource_dir: str = "",
) -> dict[str, Any]:
    """把题目导出成 Word 文档，公式为可编辑的 OMML（不是图片）。

    只在老师明确要求导出时调用。

    这个工具自带闸门：verify.status 为 red 的题、以及没有 verify 字段的题，
    会被自动拦下并列在返回的 blocked 里。**不要试图绕过它**——把未验证的题
    发给学生是这个产品唯一不能犯的错。

    problems 传完整的题目对象数组（可以直接把 problems.json 的内容传进来）。
    如果题干里引用了 assets/ 下的图，resource_dir 传课时目录的绝对路径。
    """
    return export_mod.export_docx(
        problems, out_path, title, with_answers, resource_dir or None
    )


if __name__ == "__main__":
    _maybe_start_debugger()
    server.run(transport="stdio")
