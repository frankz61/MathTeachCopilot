"""情境插图 —— 调网关上的生图模型出 PNG。

## 为什么是独立的一个工具，而不是 render_figure 的一个 kind

figure / charts / geometry 那三个模块画的是**题干的一部分**：题干写 ∠C=90°，
画出来就必须真的是 90°。所以它们只收结构化参数（表达式、坐标、数值），
按坐标实算校验，对不上拒绝出图——docs/grok.md 第五节那条「图与题干条件必须同源」
在那边是**能被机器验的**。

生图模型给不出坐标，那套校验没有输入，红线在它身上直接失效。
实测让它画「两名学生测量旗杆高度」，出来的图旗杆底座是悬空的、
皮尺右端没对准杆底——当课本情境插图完全够用，当几何配图就是把错图发给学生。

所以边界写在**工具名**上而不是参数上：模型选错工具，比选错一个 kind 参数
更容易在日志里被看见。而且下面的 `_REFUSE` 能在发请求之前就把它挡回去——
按 docs/architecture.md §4.2「约束和手段必须成对出现」，挡回去的同时
必须告诉它该改用哪个工具，否则它要么编造要么空转。

## 网络调用在这一层是新东西

其余工具全是纯本地计算，这是第一个要出网的。两个后果写在这里：
一是错误必须翻成老师看得懂的话（照抄 settings.ts 的 explain 思路），
二是**只用 stdlib 的 urllib**，不引第三方 HTTP 库——tools-py 要随包分发，
多一个依赖就多一份 prepare_vendor 的活，而这里只是一个 POST。
"""

from __future__ import annotations

import base64
import binascii
import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

# 网关上 type=image 的模型（GET /v1/images/generations 可以列出来）。
# 默认这个是实测出图质量和耗时都可接受的一档：1024x1024 约 38 秒。
DEFAULT_MODEL = "codex/gpt-5.6-luna"

# 网关声明的尺寸，传别的会被上游拒绝
SUPPORTED_SIZES = ("1024x1024", "1024x1536", "1536x1024")

# 默认追加的画风。
#
# 「不要出现任何文字」不是因为它写不出中文——实测让它画条形图，
# 「一班/二班/三班/四班」「人数」全部写对了。理由是**写对写错都没法判断**：
# 同一批测试里，标着 (-1,0) 的点画在 -1.5 上、x 轴刻度从 2 直接跳到 4。
# 图里的字一旦错了，没有任何机制能发现，而它看上去和正确的图一样可信。
# 所以关键信息一律留在题干里，图只负责画面。
DEFAULT_STYLE = "教材插图风格：简洁黑白线描，白色背景，画面干净，不要出现任何文字"

# 出现这些词就说明它想画的是**题干的一部分**，不是情境插图。
#
# 判断标准只有一条：这张图里有没有学生会去**量、去读数**的东西。
# 有，就必须走 render_figure（坐标 + asserts 实算校验）；没有，才归这里。
_REFUSE: list[tuple[tuple[str, ...], str]] = [
    (
        ("三角形", "△", "直角", "锐角", "钝角", "全等", "相似", "平行四边形",
         "梯形", "菱形", "矩形", "正方形", "多边形", "内角", "外角", "角平分线",
         "垂直平分", "中垂线", "尺规", "∠", "°"),
        'render_figure(kind="geometry")：给出各点坐标，并把题干里的每个条件写成 asserts',
    ),
    (
        ("函数图象", "函数图像", "抛物线", "双曲线", "坐标系", "坐标轴", "象限",
         "y=", "y =", "顶点式", "对称轴"),
        'render_figure(kind="function")：给出题干里那个表达式和取值范围',
    ),
    (
        ("数轴",),
        'render_figure(kind="number_line")：给出各点的值和实心/空心',
    ),
    (
        ("统计图", "条形图", "柱状图", "折线图", "扇形图", "饼图", "直方图",
         "频数分布", "统计表"),
        'render_figure(kind="bar"/"line"/"pie"/"histogram")：给出 categories 和 values',
    ),
    (
        ("圆", "半径", "直径", "弧", "扇形", "切线", "圆心"),
        'render_figure(kind="geometry")：用 circles 参数画圆，并给出 asserts',
    ),
]


def check_prompt(prompt: str) -> str | None:
    """描述里带可测量的几何/数据元素就拒绝，返回该改用什么。

    单独拆出来是为了能脱离网络单测——这条边界是这个模块存在的理由，
    它必须有测试，不能只活在文档里。
    """
    text = prompt.strip()
    if not text:
        return "prompt 是空的"
    for words, alternative in _REFUSE:
        for w in words:
            if w in text:
                return (
                    f"描述里出现了「{w}」，这属于题干的一部分，本工具不画。\n"
                    f"图里只要有学生会去量、去读数的东西，就必须能被机器校验，"
                    f"而生图模型给不出坐标、校验不了：题干写 ∠C=90° 它画成 87°，"
                    f"没有任何机制能发现，学生照着量只会越量越错。\n"
                    f"改用 {alternative}。\n"
                    f"如果你要的确实只是应用题的生活场景（不含任何尺寸、角度、数据），"
                    f"把描述里的这类词去掉再试。"
                )
    return None


def _endpoint() -> tuple[str, str] | dict[str, Any]:
    """解析网关地址和凭据，缺了就返回一个能照着做的错误。

    环境变量由 mcp.ts 显式转发（不指望继承，理由见那边的注释）。
    """
    base = (
        os.environ.get("MTC_IMAGE_BASE_URL")
        or os.environ.get("ANTHROPIC_BASE_URL")
        or ""
    ).strip().rstrip("/")
    key = (
        os.environ.get("MTC_IMAGE_KEY") or os.environ.get("ANTHROPIC_API_KEY") or ""
    ).strip()

    if not base:
        return {
            "ok": False,
            "error": "没有配置网关地址，插图生成不可用。"
            "在设置里填好 API 地址（或 .env 的 ANTHROPIC_BASE_URL）后重试。",
        }
    if not key:
        return {
            "ok": False,
            "error": "没有配置 API Key，插图生成不可用。"
            "在设置里填好 API Key（或 .env 的 ANTHROPIC_API_KEY）后重试。",
        }
    # 地址按约定不带 /v1，和 ANTHROPIC_BASE_URL 一个规矩
    return f"{base}/v1/images/generations", key


def _explain(status: int, body: str) -> str:
    """HTTP 状态翻成能照着改的话。和 settings.ts 的 explain 是同一个用意。"""
    short = " ".join(body.split())[:200]
    if status in (401, 403):
        return f"密钥被拒，检查 API Key 是否填错或已过期。{short}"
    if status == 404:
        return f"地址不对，网关上可能没有这个图模型端点。{short}"
    if status == 429:
        return f"这个模型当前被限流，稍后重试，或换一个 model 参数。{short}"
    if status == 400:
        return f"请求被拒，多半是模型名或 size 在网关上不被支持。{short}"
    if status >= 500:
        return f"网关自己出错了，不是参数问题，稍后重试。{short}"
    return f"HTTP {status}：{short}"


def _post_json(url: str, key: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
    """发请求。返回 {"ok": True, "json": ...} 或 {"ok": False, "error": ...}。

    单独一层是为了测试能替换掉它——测这个模块不该真的出网。
    """
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", "replace")
        except Exception:
            pass
        return {"ok": False, "error": _explain(e.code, body)}
    except urllib.error.URLError as e:
        return {"ok": False, "error": f"连不上网关：{e.reason}"}
    except TimeoutError:
        return {"ok": False, "error": f"{int(timeout)} 秒没有响应，出图较慢或网络不通"}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}

    try:
        return {"ok": True, "json": json.loads(raw)}
    except Exception:
        return {"ok": False, "error": f"网关返回的不是合法 JSON：{raw[:200]}"}


def _extract_png(data: dict[str, Any], timeout: float) -> tuple[bytes | None, str]:
    """从响应里取出图片字节。

    这个网关返回的是 data[0].url，值是 `data:image/png;base64,...` 的内联 URI；
    OpenAI 官方那套是 data[0].b64_json 或一个 https 外链。三种都认——
    换一个上游就报「解析失败」太蠢了，而这三种形状的判别是确定的。
    """
    items = data.get("data")
    if not isinstance(items, list) or not items:
        err = data.get("error")
        if isinstance(err, dict) and err.get("message"):
            return None, f"网关报错：{err['message']}"
        return None, f"响应里没有图片数据：{json.dumps(data, ensure_ascii=False)[:200]}"

    first = items[0]
    if not isinstance(first, dict):
        return None, "响应格式不对：data[0] 不是对象"

    b64 = first.get("b64_json")
    if isinstance(b64, str) and b64:
        try:
            return base64.b64decode(b64), ""
        except (binascii.Error, ValueError) as e:
            return None, f"b64_json 解不开：{e}"

    url = first.get("url")
    if isinstance(url, str) and url.startswith("data:"):
        marker = "base64,"
        at = url.find(marker)
        if at < 0:
            return None, "data URI 里没有 base64 段"
        try:
            return base64.b64decode(url[at + len(marker) :]), ""
        except (binascii.Error, ValueError) as e:
            return None, f"data URI 解不开：{e}"

    if isinstance(url, str) and url.startswith("http"):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as resp:
                return resp.read(), ""
        except Exception as e:
            return None, f"图片外链下载失败：{e}"

    return None, "响应里既没有 b64_json 也没有可用的 url"


def generate(
    prompt: str,
    out_path: str,
    size: str = "1024x1024",
    model: str = "",
    style: str = DEFAULT_STYLE,
    timeout: float = 180.0,
) -> dict[str, Any]:
    """按自然语言描述生成一张情境插图，存成 PNG。

    只用于**不含任何可测量元素**的场景图。带几何量或数据的图走 render_figure。
    """
    refusal = check_prompt(prompt)
    if refusal:
        return {"ok": False, "error": refusal}

    if size not in SUPPORTED_SIZES:
        return {
            "ok": False,
            "error": f"size 只支持 {'、'.join(SUPPORTED_SIZES)}，收到的是 {size}",
        }

    out = Path(out_path)
    if out.suffix.lower() != ".png":
        return {
            "ok": False,
            "error": f"out_path 必须以 .png 结尾（收到 {out.suffix or '无后缀'}）。"
            "生图模型出的是位图，拿不到 SVG——SVG 只有 render_figure 才有。",
        }

    endpoint = _endpoint()
    if isinstance(endpoint, dict):
        return endpoint
    url, key = endpoint

    full_prompt = f"{prompt.strip()}。{style}" if style else prompt.strip()
    result = _post_json(
        url,
        key,
        {
            "model": model or os.environ.get("MTC_IMAGE_MODEL") or DEFAULT_MODEL,
            "prompt": full_prompt,
            "n": 1,
            "size": size,
        },
        timeout,
    )
    if not result["ok"]:
        return {"ok": False, "error": result["error"]}

    png, err = _extract_png(result["json"], timeout)
    if png is None:
        return {"ok": False, "error": err}

    # 校验真的是张图再落盘。写进去一个 JSON 错误串、题干却照样引用它，
    # 表现是渲染层图裂、导出到 Word 是个空洞——和引用不存在的图一样难查。
    if not png.startswith(b"\x89PNG\r\n\x1a\n"):
        return {"ok": False, "error": "拿到的不是 PNG 数据，没有写盘"}

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(png)
    return {"ok": True, "path": str(out), "bytes": len(png)}
