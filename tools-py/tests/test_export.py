"""导出闸门的测试。

这个闸门是「未验证的题不能发给学生」这条产品红线的唯一强制点，
所以它必须在没有 pandoc 的机器上也能被测到——gate() 是纯函数，不碰 pandoc。
"""

from mathtools.export import gate, render_markdown


def _p(pid: str, status: str | None, tier: str = "A") -> dict:
    return {
        "id": pid,
        "stem": "解方程 $x^2-5x+6=0$",
        "answer": "$x_1=2,\\ x_2=3$",
        "solution": ["因式分解得 $(x-2)(x-3)=0$", "所以 $x_1=2,\\ x_2=3$"],
        "tier": tier,
        "figureRefs": [],
        "verify": None if status is None else {"status": status, "log": "测试用"},
    }


class TestGate:
    def test_绿色可以导出(self):
        ok, blocked = gate([_p("p1", "green")])
        assert len(ok) == 1 and not blocked

    def test_黄色可以导出(self):
        # 黄 = 检查器覆盖不到，不是错。老师预览后自行判断。
        ok, blocked = gate([_p("p1", "yellow")])
        assert len(ok) == 1 and not blocked

    def test_红色被拦下(self):
        ok, blocked = gate([_p("p1", "red")])
        assert not ok
        assert blocked[0]["id"] == "p1" and "验算失败" in blocked[0]["reason"]

    def test_未验证被拦下(self):
        ok, blocked = gate([_p("p1", None)])
        assert not ok
        assert blocked[0]["reason"] == "未验证"

    def test_混合时只放行合格的(self):
        ok, blocked = gate(
            [_p("p1", "green"), _p("p2", "red"), _p("p3", None), _p("p4", "yellow")]
        )
        assert {p["id"] for p in ok} == {"p1", "p4"}
        assert {b["id"] for b in blocked} == {"p2", "p3"}


class TestRenderMarkdown:
    def test_按分层分组且公式保持latex(self):
        md = render_markdown(
            [_p("p1", "green", "A"), _p("p2", "green", "C")], "分层作业", True
        )
        assert "## A 基础" in md and "## C 拓展" in md
        assert "## B 提升" not in md, "空的层不该出现"
        # 公式必须以 $...$ 原样交给 pandoc，它才能转成 OMML
        assert "$x^2-5x+6=0$" in md
        assert "参考答案与解析" in md

    def test_不带答案时不渲染解析(self):
        md = render_markdown([_p("p1", "green")], "分层作业", False)
        assert "参考答案与解析" not in md
