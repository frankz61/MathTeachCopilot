r"""公式文本规范化。每条用例都是导出的 Word 里真实出过的样子。"""

from __future__ import annotations

from mathtools.mathtext import box_table, normalize, to_markdown, unbalanced


def test_公式两端的空格被去掉() -> None:
    assert normalize("则 $k = $____。")[0] == "则 $k =$____。"


def test_多转义的命令被修回() -> None:
    fixed, notes = normalize(r"观察：$2, 4, 8, \\dots$；$1\\times 2 = 2$")
    assert fixed == r"观察：$2, 4, 8, \dots$；$1\times 2 = 2$"
    assert notes


def test_cases_里的换行不能被当成多转义() -> None:
    s = r"$\begin{cases}x=1\\y=2\end{cases}$"
    assert normalize(s)[0] == s


def test_紧挨的两个公式中间补空格() -> None:
    fixed, _ = normalize(r"$1\times 2=2$$2\times 3=6$")
    assert fixed == r"$1\times 2=2$ $2\times 3=6$"
    assert "$$" not in fixed


def test_公式后紧跟数字补空格() -> None:
    assert normalize("$x=1$2 个解")[0] == "$x=1$ 2 个解"


def test_没有公式的文字原样返回() -> None:
    assert normalize("学生独立思考后交流") == ("学生独立思考后交流", [])


def test_落单的美元符号能查出来() -> None:
    assert unbalanced("若 $x=2，则")
    assert not unbalanced("若 $x=2$，则")
    assert not unbalanced(r"单价 \$5")


def test_导出时填空下划线不变成强调() -> None:
    md = to_markdown(r"$-\frac{\pi x^2y}{3}$ 的系数是_，次数是_")
    assert r"系数是\_，次数是\_" in md
    assert r"\frac{\pi x^2y}{3}" in md  # 公式里的下标 _ 不能动


def test_图片路径里的下划线不转义() -> None:
    assert "![](assets/fig_1.svg)" in to_markdown("如图 ![](assets/fig_1.svg)，求 x_1")


def test_分行保留_表格前补空行() -> None:
    md = to_markdown("一、概念对比\n| 图形 | 端点数 |\n|---|---|\n| 线段 | 2 |\n二、表示方法\n线段 AB")
    lines = md.split("\n")
    assert lines[0] == "一、概念对比"
    assert lines[1] == ""  # 表格前空行
    assert lines[2] == "| 图形 | 端点数 |"
    assert "二、表示方法\\" in lines  # 硬换行
    assert lines[-1] == "线段 AB"


def test_手画的框线表格能认出来() -> None:
    assert box_table("+——+———+\n| 图形 | 端点数 |")
    assert not box_table("| 图形 | 端点数 |\n|---|---|")
