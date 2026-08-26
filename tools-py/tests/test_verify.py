"""验算器的测试。

重点不是「对的题能通过」，而是**错的题必须被拦下**。
产品的生死线在这里（docs/claude.md 第三节红线），所以反例比正例重要。
"""

from mathtools.verify import (
    check_answer_shape,
    verify_evaluate,
    verify_identity,
    verify_solve,
)


class TestSolve:
    def test_正确的二次方程解通过(self):
        r = verify_solve("x^2 - 5*x + 6 = 0", "x", ["2", "3"])
        assert r.status == "green"
        assert len(r.paths) == 2
        assert all(p.ok for p in r.paths)

    def test_错误的根被拦下(self):
        r = verify_solve("x^2 - 5*x + 6 = 0", "x", ["2", "4"])
        assert r.status == "red"
        assert "substitute-back" in r.log or "sympy.solve" in r.log

    def test_漏掉一个根被拦下(self):
        # 代回路径会通过（2 确实是根），但解集比对会发现少了 3。
        # 这正是需要两条路径的原因：单靠代回抓不到漏根。
        r = verify_solve("x^2 - 5*x + 6 = 0", "x", ["2"])
        assert r.status == "red"
        substitute = next(p for p in r.paths if p.name == "substitute-back")
        solve = next(p for p in r.paths if p.name == "sympy.solve")
        assert substitute.ok, "代回路径应该通过——它抓不到漏根"
        assert not solve.ok, "解集比对路径应该抓到漏根"

    def test_多余的根被拦下(self):
        r = verify_solve("x^2 - 5*x + 6 = 0", "x", ["2", "3", "5"])
        assert r.status == "red"

    def test_一元一次方程(self):
        assert verify_solve("3*x + 7 = 22", "x", ["5"]).status == "green"

    def test_重根(self):
        assert verify_solve("x^2 - 4*x + 4 = 0", "x", ["2"]).status == "green"

    def test_题面写坏了也是red(self):
        r = verify_solve("x^2 - +* 5 = 0", "x", ["1"])
        assert r.status == "red"

    def test_不带等号视为等于零(self):
        assert verify_solve("x^2 - 9", "x", ["3", "-3"]).status == "green"


class TestIdentity:
    def test_正确的因式分解通过(self):
        assert verify_identity("x^2 - 4", "(x + 2)*(x - 2)").status == "green"

    def test_错误的因式分解被拦下(self):
        r = verify_identity("x^2 - 4", "(x + 2)*(x - 4)")
        assert r.status == "red"

    def test_完全平方公式(self):
        assert verify_identity("(a + b)^2", "a^2 + 2*a*b + b^2").status == "green"

    def test_经典错误_漏掉交叉项(self):
        # 学生最常犯的错，也是模型最常犯的错
        r = verify_identity("(a + b)^2", "a^2 + b^2")
        assert r.status == "red"

    def test_分式化简(self):
        assert verify_identity("(x^2 - 1)/(x - 1)", "x + 1").status == "green"


class TestEvaluate:
    def test_正确求值(self):
        assert verify_evaluate("x^2 + 3*x", {"x": "4"}, "28").status == "green"

    def test_错误求值被拦下(self):
        assert verify_evaluate("x^2 + 3*x", {"x": "4"}, "27").status == "red"


class TestAnswerShape:
    def test_整数解是好题(self):
        r = check_answer_shape("x^2 - 5*x + 6 = 0", "x")
        assert r["ok"]
        assert r["facts"]["discriminantIsPerfectSquare"]

    def test_无理根会被挑出来(self):
        r = check_answer_shape("x^2 - 2 = 0", "x")
        assert not r["ok"]
        assert any("完全平方" in i or "有理数" in i for i in r["issues"])

    def test_判别式为负会被挑出来(self):
        r = check_answer_shape("x^2 + x + 5 = 0", "x")
        assert not r["ok"]
        assert any("无解" in i for i in r["issues"])

    def test_分母过大的根会被挑出来(self):
        r = check_answer_shape("13*x - 7 = 0", "x")
        assert not r["ok"]
        assert any("分母" in i for i in r["issues"])
