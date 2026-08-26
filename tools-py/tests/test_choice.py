r"""选择题的验算与闸门。

加这一档之前，选择题的答案是「B」一个字母，solve/identity/evaluate 三种规格
都表达不了「B 对应的值是 2，而 A/C/D 都不是 2」，于是只能标 manual → 黄色。
而黄色进不了发给学生的卷子，提示词又把 manual 当降级——实测 72 道题里选择题
只占 11%，8 道里 7 道是黄的，等于这个题型形同废弃。

最值钱的一条是 test_两个选项数学等价被拒收：**「不止一个正确选项」在题面上
完全看不出来**，老师印了发下去、学生按另一个正确选项答被判错才会发现。
字符串比较查不出 `$x=2$ 或 $x=3$` 和 `$x=3$ 或 $x=2$` 是同一个答案，实算才行。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from mathtools.store import save_problems
from mathtools.verify import verify_choice


def _c(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": "c1",
        "stem": r"方程 $x^{2}-4x+4=0$ 的解是（　　）",
        "answer": "B",
        "solution": [r"配方得 $(x-2)^{2}=0$", r"所以 $x=2$"],
        "tier": "A",
        "type": "选择",
        "knowledgePointIds": ["rj-tp-21-03"],
        "figureRefs": [],
        "variantSeed": None,
        "options": {"A": "$x=1$", "B": "$x=2$", "C": "$x=3$", "D": "$x=4$"},
        "check": {
            "kind": "choice",
            "correct": "B",
            "basis": {
                "kind": "solve",
                "equation": "x^2 - 4*x + 4 = 0",
                "variable": "x",
                "claimed_roots": ["2"],
            },
        },
    }
    base.update(over)
    return base


SOLVE_23 = {
    "kind": "solve",
    "equation": "x^2 - 5*x + 6 = 0",
    "variable": "x",
    "claimed_roots": ["2", "3"],
}


class Test三条路径:
    def test_正常选择题三条路径都过且为绿(self) -> None:
        r = verify_choice(
            {"A": "$x=1$", "B": "$x=2$", "C": "$x=3$", "D": "$x=4$"},
            "B",
            {
                "kind": "solve",
                "equation": "x^2-4*x+4=0",
                "variable": "x",
                "claimed_roots": ["2"],
            },
        )
        assert r.status == "green"
        assert [p.name for p in r.paths] == ["option-set", "correct-option", "distractors"]

    def test_correct不在选项里(self) -> None:
        r = verify_choice({"A": "1", "B": "2"}, "C", {"kind": "manual", "reason": "x"})
        assert r.status == "red" and "不在选项里" in r.log

    def test_只有一个选项(self) -> None:
        r = verify_choice({"A": "1"}, "A", {"kind": "manual", "reason": "x"})
        assert r.status == "red" and "至少要 2 个" in r.log

    def test_正确选项其实是错的(self) -> None:
        r = verify_choice(
            {"A": "$x=1$", "B": "$x=9$", "C": "$x=3$", "D": "$x=4$"},
            "B",
            {
                "kind": "solve",
                "equation": "x^2-4*x+4=0",
                "variable": "x",
                "claimed_roots": ["2"],
            },
        )
        assert r.status == "red"
        assert any(p.name == "correct-option" and not p.ok for p in r.paths)


class Test不止一个正确选项:
    """这一组是加 choice 这一档最主要的理由。"""

    def test_两个选项字面相同(self) -> None:
        r = verify_choice(
            {"A": "$x=2$", "B": "$x=2$", "C": "$x=3$", "D": "$x=4$"}, "A", SOLVE_23
        )
        assert r.status == "red" and "内容相同" in r.log

    def test_两个选项数学等价但写法不同(self) -> None:
        # 字符串比较查不出来：换个顺序写就是同一个解集
        r = verify_choice(
            {
                "A": "$x=3$ 或 $x=2$",
                "B": "$x=2$ 或 $x=3$",
                "C": "$x=1$",
                "D": "$x=6$",
            },
            "B",
            SOLVE_23,
        )
        assert r.status == "red"
        assert "不止一个正确选项" in r.log and "A" in r.log

    def test_分数和小数是同一个值(self) -> None:
        r = verify_choice(
            {"A": r"$\frac{1}{2}$", "B": "0.5", "C": "2", "D": "1"},
            "A",
            {"kind": "evaluate", "expression": "1/(1+1)", "substitutions": {}, "claimed": "1/2"},
        )
        assert r.status == "red" and "不止一个正确选项" in r.log

    def test_因式分解换个因式顺序(self) -> None:
        r = verify_choice(
            {
                "A": "$(x-1)(x-2)$",
                "B": "$(x+1)(x+2)$",
                "C": "$(x+1)(x-2)$",
                "D": "$(x-2)(x-1)$",
            },
            "A",
            {"kind": "identity", "left": "x^2-3*x+2", "right": "(x-1)*(x-2)"},
        )
        assert r.status == "red" and "不止一个正确选项" in r.log


class Test选项本身是待判的式子:
    """「下列…中，正确的是」这一族。

    选项不是候选答案，而是待判的式子。没有 {option} 占位的话这一族只能落到黄色，
    而它占选择题很大一部分——实测老数据里 8 道选择题就有 1 道是这个形状。
    """

    def test_下列方程中解为2的是(self) -> None:
        r = verify_choice(
            {"A": "$3x-1=2x+1$", "B": "$3x+1=2x$", "C": "$x+2=0$", "D": "$3x-2=x$"},
            "A",
            {
                "kind": "solve",
                "equation": "{option}",
                "variable": "x",
                "claimed_roots": ["2"],
            },
        )
        assert r.status == "green"
        assert [p.name for p in r.paths] == ["option-set", "correct-option", "distractors"]

    def test_占位模式下也能抓出第二个正确选项(self) -> None:
        # 5x-4=3x 的解也是 2，和 A 撞了。题面上完全看不出来。
        r = verify_choice(
            {"A": "$3x-1=2x+1$", "B": "$3x+1=2x$", "C": "$x+2=0$", "D": "$5x-4=3x$"},
            "A",
            {
                "kind": "solve",
                "equation": "{option}",
                "variable": "x",
                "claimed_roots": ["2"],
            },
        )
        assert r.status == "red"
        assert "不止一个正确选项" in r.log and "D" in r.log

    def test_下列与某式相等的是(self) -> None:
        r = verify_choice(
            {
                "A": "$(x+2)(x-2)$",
                "B": "$(x-2)^2$",
                "C": "$(x+2)^2$",
                "D": "$x(x-4)$",
            },
            "A",
            {"kind": "identity", "left": "{option}", "right": "x^2-4"},
        )
        assert r.status == "green"

    def test_占位模式下正确选项错了仍判红(self) -> None:
        r = verify_choice(
            {"A": "$3x-1=2x+1$", "B": "$3x+1=2x$", "C": "$x+2=0$", "D": "$3x-2=x$"},
            "C",
            {
                "kind": "solve",
                "equation": "{option}",
                "variable": "x",
                "claimed_roots": ["2"],
            },
        )
        assert r.status == "red"
        assert any(p.name == "correct-option" and not p.ok for p in r.paths)

    def test_不带占位的老用法不受影响(self) -> None:
        r = verify_choice(
            {"A": "$x=1$", "B": "$x=2$", "C": "$x=3$", "D": "$x=4$"},
            "B",
            {
                "kind": "solve",
                "equation": "x^2-4*x+4=0",
                "variable": "x",
                "claimed_roots": ["2"],
            },
        )
        assert r.status == "green"

    def test_占位符走闸门(self, tmp_path: Path) -> None:
        out = str(tmp_path / "problems.json")
        r = save_problems(
            [
                _c(
                    stem=r"下列方程中，解为 $x=2$ 的是（　　）",
                    answer="A",
                    options={
                        "A": "$3x-1=2x+1$",
                        "B": "$3x+1=2x$",
                        "C": "$x+2=0$",
                        "D": "$3x-2=x$",
                    },
                    check={
                        "kind": "choice",
                        "correct": "A",
                        "basis": {
                            "kind": "solve",
                            "equation": "{option}",
                            "variable": "x",
                            "claimed_roots": ["2"],
                        },
                    },
                )
            ],
            out,
        )
        assert r["ok"] and r["written"] == 1
        rec = json.loads(Path(out).read_text(encoding="utf-8"))[0]
        assert rec["verify"]["status"] == "green"


class Test能力边界要如实说:
    """「判不了」和「验出来是错的」必须分开。混起来会拦死一整类正当的选择题。"""

    def test_文字选项不能被当成已验过的干扰项(self) -> None:
        # sympy 会把「以上都不对」当成一个符号解析"成功"，比对失败后看起来像是
        # 一个已验证过的错误干扰项——实际上根本没验。必须显式判成"判不了"。
        r = verify_choice(
            {"A": "$x=2$", "B": "以上都不对", "C": "$x=3$", "D": "$x=5$"},
            "A",
            {
                "kind": "solve",
                "equation": "x^2-4*x+4=0",
                "variable": "x",
                "claimed_roots": ["2"],
            },
        )
        assert r.status == "yellow"
        assert "无法机器判定" in r.log and "B" in r.log

    def test_正确选项是文字表述时给黄不给红(self) -> None:
        # 「以上都不对」作为正确答案是合法题型，判红等于把它拦死在门外
        r = verify_choice(
            {"A": "$x=2$", "B": "以上都不对", "C": "$x=3$", "D": "$x=5$"},
            "B",
            {
                "kind": "solve",
                "equation": "x^2-4*x+4=0",
                "variable": "x",
                "claimed_roots": ["2"],
            },
        )
        assert r.status == "yellow" and "basis" in r.log

    def test_连接词不算文字表述(self) -> None:
        # '$x=2$ 或 $x=3$' 里的「或」是连接词，不该让整个选项被判成散文
        r = verify_choice(
            {"A": "$x=2$ 或 $x=3$", "B": "$x=1$", "C": "$x=6$", "D": "$x=5$"},
            "A",
            SOLVE_23,
        )
        assert r.status == "green"

    def test_概念题用manual依据仍会校验选项集合(self) -> None:
        r = verify_choice(
            {"A": "1", "B": "2", "C": "3", "D": "4"},
            "B",
            {"kind": "manual", "reason": "0 的归属需教师确认"},
        )
        assert r.status == "yellow"
        assert [p.name for p in r.paths] == ["option-set"]
        assert "两两互异" in r.log and "0 的归属" in r.log


class Test闸门:
    def test_选择题正常写入(self, tmp_path: Path) -> None:
        out = str(tmp_path / "problems.json")
        r = save_problems([_c()], out)
        assert r["ok"] and r["written"] == 1
        rec = json.loads(Path(out).read_text(encoding="utf-8"))[0]
        assert rec["verify"]["status"] == "green"
        # 选项是题目内容，必须跟着落盘，否则卷子上的选择题只有问句没有选项
        assert rec["options"]["B"] == "$x=2$"
        # check 也要留着：老师改题时要按它重新验算
        assert rec["check"]["kind"] == "choice"

    def test_选择题用manual被结构校验拦下(self, tmp_path: Path) -> None:
        r = save_problems(
            [_c(check={"kind": "manual", "reason": "概念题"})],
            str(tmp_path / "problems.json"),
        )
        assert not r["ok"]
        assert any("必须用" in e and "choice" in e for e in r["errors"])

    def test_选择题缺options被拦下(self, tmp_path: Path) -> None:
        p = _c()
        del p["options"]
        r = save_problems([p], str(tmp_path / "problems.json"))
        assert not r["ok"]
        assert any("options" in e for e in r["errors"])

    def test_选项重复写进题干被拦下(self, tmp_path: Path) -> None:
        # 两处都写会让界面和 Word 里各出现一份选项
        r = save_problems(
            [_c(stem="方程的解是（　　）\n\nA. $x=1$　B. $x=2$　C. $x=3$　D. $x=4$")],
            str(tmp_path / "problems.json"),
        )
        assert not r["ok"]
        assert any("题干里不要再写一遍" in e for e in r["errors"])

    def test_choice用在非选择题上被拦下(self, tmp_path: Path) -> None:
        r = save_problems([_c(type="解答")], str(tmp_path / "problems.json"))
        assert not r["ok"]
        assert any("type 就该是" in e for e in r["errors"])

    def test_缺basis被拦下并说明怎么补(self, tmp_path: Path) -> None:
        r = save_problems(
            [_c(check={"kind": "choice", "correct": "B"})],
            str(tmp_path / "problems.json"),
        )
        assert not r["ok"]
        assert any("basis" in e and "solve" in e for e in r["errors"])

    def test_不止一个正确选项被拒收且不写盘(self, tmp_path: Path) -> None:
        out = tmp_path / "problems.json"
        r = save_problems(
            [
                _c(
                    options={
                        "A": "$x=3$ 或 $x=2$",
                        "B": "$x=2$ 或 $x=3$",
                        "C": "$x=1$",
                        "D": "$x=6$",
                    },
                    check={"kind": "choice", "correct": "B", "basis": SOLVE_23},
                )
            ],
            str(out),
        )
        assert not r["ok"] and r["written"] == 0
        assert "不止一个正确选项" in r["rejected"][0]["reason"]
        assert not out.exists()

    def test_伪造的verify无效(self, tmp_path: Path) -> None:
        # 和 test_store 里同一条红线：模型说绿不算绿
        out = str(tmp_path / "problems.json")
        r = save_problems(
            [
                _c(
                    check={"kind": "choice", "correct": "D", "basis": SOLVE_23},
                    verify={"status": "green", "checkedAt": "假的", "paths": [], "log": ""},
                )
            ],
            out,
        )
        assert not r["ok"], "正确选项是错的，却因为提交了绿色 verify 就通过了"

    def test_选项落到卷子上(self, tmp_path: Path) -> None:
        # 光验对了没用——选项存进 options 之后，卷子上必须真的印出来。
        # 漏了这一步的话，学生拿到的选择题只有问句、没有选项。
        from mathtools.homework import render

        out = str(tmp_path / "problems.json")
        save_problems([_c()], out)
        problems = json.loads(Path(out).read_text(encoding="utf-8"))
        md = render(problems, "测试卷")
        assert "A. $x=1$" in md and "D. $x=4$" in md
        # 短选项排一行，用全角空格分隔（教材排法，且 pandoc 不会折叠全角空格）
        assert "A. $x=1$　　B. $x=2$" in md

    def test_长选项一项一行(self) -> None:
        from mathtools.homework import option_lines

        long_opts = {
            "A": "一元二次方程一定有两个不相等的实数根",
            "B": "判别式等于零时有两个相等的实数根",
        }
        lines = option_lines({"options": long_opts})
        assert len(lines) == 3  # 两行选项 + 一个空行
        assert lines[0].startswith("A. ") and lines[1].startswith("B. ")

    def test_非选择题不渲染选项(self) -> None:
        from mathtools.homework import option_lines

        assert option_lines({"stem": "解方程"}) == []
        assert option_lines({"options": {}}) == []

    def test_非选择题不受影响(self, tmp_path: Path) -> None:
        out = str(tmp_path / "problems.json")
        p = _c(
            id="s1",
            type="解答",
            stem=r"解方程 $x^{2}-4x+4=0$",
            answer="$x=2$",
            check={
                "kind": "solve",
                "equation": "x^2-4*x+4=0",
                "variable": "x",
                "claimed_roots": ["2"],
            },
        )
        del p["options"]
        r = save_problems([p], out)
        assert r["ok"] and r["written"] == 1
        assert json.loads(Path(out).read_text(encoding="utf-8"))[0]["verify"]["status"] == "green"
