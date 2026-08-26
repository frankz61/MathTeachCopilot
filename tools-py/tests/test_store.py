r"""problems.json 写入闸门的测试。

最重要的一条：**模型伪造的 verify 字段必须无效**。
这是产品唯一不能犯的错，不能只靠系统提示里的道德约束。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from mathtools.store import save_problems


def _p(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": "p1",
        "stem": r"解方程 $x^{2}-5x+6=0$。",
        "answer": r"$x_{1}=2$，$x_{2}=3$",
        "solution": [r"因式分解得 $(x-2)(x-3)=0$", r"所以 $x_{1}=2$，$x_{2}=3$"],
        "tier": "A",
        "type": "解答",
        "knowledgePointIds": ["rj-tp-25-04"],
        "figureRefs": [],
        "variantSeed": {"template": "解方程 $x^2+{b}x+{c}=0$", "params": {}, "constraints": []},
        "check": {
            "kind": "solve",
            "equation": "x^2 - 5*x + 6 = 0",
            "variable": "x",
            "claimed_roots": ["2", "3"],
        },
    }
    base.update(over)
    return base


class Test伪造验证:
    def test_模型填的verify字段被无视(self, tmp_path: Path) -> None:
        # 模型交上来一个伪造的 green，但答案其实是错的
        forged = _p(
            answer="$x_{1}=2$，$x_{2}=4$",
            check={
                "kind": "solve",
                "equation": "x^2 - 5*x + 6 = 0",
                "variable": "x",
                "claimed_roots": ["2", "4"],
            },
            verify={"status": "green", "checkedAt": "伪造", "paths": [], "log": "看起来没问题"},
        )
        out = tmp_path / "problems.json"
        r = save_problems([forged], str(out))
        assert not r["ok"], "伪造的 green 竟然通过了"
        assert r["rejected"][0]["id"] == "p1"
        assert not out.exists(), "验算不过却写了盘"

    def test_真验算通过时verify由工具自己写(self, tmp_path: Path) -> None:
        out = tmp_path / "problems.json"
        r = save_problems([_p(verify={"status": "red", "log": "模型瞎填的"})], str(out))
        assert r["ok"] and r["green"] == 1
        written = json.loads(out.read_text(encoding="utf-8"))[0]
        assert written["verify"]["status"] == "green", "工具应覆盖模型填的 verify"
        assert len(written["verify"]["paths"]) == 2, "双路径验证戳应该在"
        assert written["verify"]["log"] == ""


class Test结构校验:
    def test_solution写成字符串会被指名报错(self, tmp_path: Path) -> None:
        r = save_problems([_p(solution="一整段解析")], str(tmp_path / "p.json"))
        assert not r["ok"]
        assert any("solution" in e and "数组" in e for e in r["errors"])

    def test_solution只有一步不算解析(self, tmp_path: Path) -> None:
        r = save_problems([_p(solution=["直接得答案"])], str(tmp_path / "p.json"))
        assert not r["ok"]
        assert any("至少要 2 步" in e for e in r["errors"])

    def test_variantSeed写成字符串会被指名报错(self, tmp_path: Path) -> None:
        r = save_problems([_p(variantSeed="quadratic-v1")], str(tmp_path / "p.json"))
        assert not r["ok"]
        assert any("variantSeed" in e and "对象" in e for e in r["errors"])

    def test_type用了不存在的枚举值(self, tmp_path: Path) -> None:
        r = save_problems([_p(type="解答题")], str(tmp_path / "p.json"))
        assert not r["ok"]
        assert any("type" in e for e in r["errors"])

    def test_tier非法(self, tmp_path: Path) -> None:
        r = save_problems([_p(tier="D")], str(tmp_path / "p.json"))
        assert not r["ok"]
        assert any("tier" in e for e in r["errors"])

    def test_缺check(self, tmp_path: Path) -> None:
        p = _p()
        del p["check"]
        r = save_problems([p], str(tmp_path / "p.json"))
        assert not r["ok"]
        assert any("check" in e for e in r["errors"])

    def test_id重复(self, tmp_path: Path) -> None:
        r = save_problems([_p(), _p()], str(tmp_path / "p.json"))
        assert not r["ok"]
        assert any("id 重复" in e for e in r["errors"])

    def test_结构有错时一道也不写(self, tmp_path: Path) -> None:
        out = tmp_path / "p.json"
        save_problems([_p(), _p(id="p2", tier="X")], str(out))
        assert not out.exists(), "有错就该整体不写，不能写一半"


class TestLaTeX原样保留:
    def test_反斜杠公式不会被破坏(self, tmp_path: Path) -> None:
        stem = r"用公式法解方程，其中 $\Delta=b^{2}-4ac$，$x=\dfrac{-b\pm\sqrt{\Delta}}{2a}$。"
        out = tmp_path / "p.json"
        r = save_problems([_p(stem=stem)], str(out))
        assert r["ok"]
        # 走 json.dumps 序列化，反斜杠自动正确转义，读回来必须一模一样
        assert json.loads(out.read_text(encoding="utf-8"))[0]["stem"] == stem


class TestManual:
    def test_manual给黄色且带理由(self, tmp_path: Path) -> None:
        out = tmp_path / "p.json"
        r = save_problems(
            [_p(check={"kind": "manual", "reason": "需判断实际意义，检查器覆盖不到"})],
            str(out),
        )
        assert r["ok"] and r["yellow"] == 1 and r["green"] == 0
        v = json.loads(out.read_text(encoding="utf-8"))[0]["verify"]
        assert v["status"] == "yellow"
        assert "实际意义" in v["log"]

    def test_manual没给理由也会留痕(self, tmp_path: Path) -> None:
        out = tmp_path / "p.json"
        r = save_problems([_p(check={"kind": "manual"})], str(out))
        assert r["ok"]
        v = json.loads(out.read_text(encoding="utf-8"))[0]["verify"]
        assert "没有说明理由" in v["log"]


class Test混合:
    def test_好题写入坏题拒收(self, tmp_path: Path) -> None:
        good = _p(id="good")
        bad = _p(
            id="bad",
            check={
                "kind": "solve",
                "equation": "x^2 - 5*x + 6 = 0",
                "variable": "x",
                "claimed_roots": ["2", "4"],
            },
        )
        out = tmp_path / "p.json"
        r = save_problems([good, bad], str(out))
        assert r["ok"] and r["written"] == 1
        assert r["rejected"][0]["id"] == "bad"
        assert [p["id"] for p in json.loads(out.read_text(encoding="utf-8"))] == ["good"]


class Test追加模式:
    """出变式和分批提交都依赖它。

    没有 append 的话：「出变式」只能整卷重交；题一多一次性提交的工具参数
    还会被截断（实测 3 道就触发，一轮跑了近十分钟）。
    """

    def test_默认是覆盖(self, tmp_path: Path) -> None:
        out = tmp_path / "p.json"
        save_problems([_p(id="old")], str(out))
        save_problems([_p(id="new")], str(out))
        assert [p["id"] for p in json.loads(out.read_text(encoding="utf-8"))] == ["new"]

    def test_append保留已有的题(self, tmp_path: Path) -> None:
        out = tmp_path / "p.json"
        save_problems([_p(id="old")], str(out))
        r = save_problems([_p(id="new")], str(out), mode="append")
        assert r["ok"] and r["written"] == 1 and r["total"] == 2
        assert [p["id"] for p in json.loads(out.read_text(encoding="utf-8"))] == ["old", "new"]

    def test_append时id撞车会被拦下(self, tmp_path: Path) -> None:
        out = tmp_path / "p.json"
        save_problems([_p(id="p1")], str(out))
        r = save_problems([_p(id="p1")], str(out), mode="append")
        assert not r["ok"]
        assert any("已经有了" in e for e in r["errors"])
        # 原文件不能被动过
        assert len(json.loads(out.read_text(encoding="utf-8"))) == 1

    def test_append到不存在的文件等同新建(self, tmp_path: Path) -> None:
        out = tmp_path / "p.json"
        r = save_problems([_p(id="p1")], str(out), mode="append")
        assert r["ok"] and r["total"] == 1

    def test_append时坏题仍被拒收且不影响已有的(self, tmp_path: Path) -> None:
        out = tmp_path / "p.json"
        save_problems([_p(id="good")], str(out))
        bad = _p(
            id="bad",
            check={
                "kind": "solve",
                "equation": "x^2 - 5*x + 6 = 0",
                "variable": "x",
                "claimed_roots": ["9"],
            },
        )
        r = save_problems([bad], str(out), mode="append")
        assert not r["ok"] and r["rejected"][0]["id"] == "bad"
        assert [p["id"] for p in json.loads(out.read_text(encoding="utf-8"))] == ["good"]

    def test_非法mode(self, tmp_path: Path) -> None:
        r = save_problems([_p()], str(tmp_path / "p.json"), mode="merge")
        assert not r["ok"] and any("mode" in e for e in r["errors"])


class Test老师改题:
    """docs/claude.md 第五节：「产物必须可编辑」。

    但编辑必须重新验算——老师把答案从 2 改成 3，那个绿色的「已验证」
    就变成了谎言，而它还是可导出的，等于产品在替一道错题背书。
    """

    def _file(self, tmp_path: Path, ps: list[dict]) -> str:
        out = tmp_path / "p.json"
        save_problems(ps, str(out))
        return str(out)

    def test_只改这一道其余不动(self, tmp_path: Path) -> None:
        out = self._file(tmp_path, [_p(id="a"), _p(id="b"), _p(id="c")])
        edited = _p(id="b", stem="改过的题干 $x^2-5x+6=0$")
        r = save_problems([edited], out, mode="replace_one")
        assert r["ok"] and r["total"] == 3
        got = json.loads(Path(out).read_text(encoding="utf-8"))
        assert [p["id"] for p in got] == ["a", "b", "c"], "顺序变了"
        assert got[1]["stem"] == "改过的题干 $x^2-5x+6=0$"
        assert got[0]["stem"] != got[1]["stem"]

    def test_答案改错了保不住且原题留着(self, tmp_path: Path) -> None:
        out = self._file(tmp_path, [_p(id="a")])
        原题 = json.loads(Path(out).read_text(encoding="utf-8"))[0]

        坏的 = _p(
            id="a",
            answer="$x_{1}=2$，$x_{2}=9$",
            check={
                "kind": "solve",
                "equation": "x^2 - 5*x + 6 = 0",
                "variable": "x",
                "claimed_roots": ["2", "9"],
            },
        )
        r = save_problems([坏的], out, mode="replace_one")
        assert not r["ok"], "改错了却保存成功"
        assert r["rejected"][0]["id"] == "a"

        现在 = json.loads(Path(out).read_text(encoding="utf-8"))[0]
        assert 现在["answer"] == 原题["answer"], "原题被改坏的版本覆盖了"
        assert 现在["verify"]["status"] == "green"

    def test_改对了会重新验算并给绿(self, tmp_path: Path) -> None:
        out = self._file(tmp_path, [_p(id="a")])
        edited = _p(
            id="a",
            answer="$x_{1}=1$，$x_{2}=4$",
            check={
                "kind": "solve",
                "equation": "x^2 - 5*x + 4 = 0",
                "variable": "x",
                "claimed_roots": ["1", "4"],
            },
        )
        r = save_problems([edited], out, mode="replace_one")
        assert r["ok"]
        got = json.loads(Path(out).read_text(encoding="utf-8"))[0]
        assert got["verify"]["status"] == "green"
        assert "1" in got["verify"]["paths"][0]["detail"]

    def test_check规格跟着题目落盘(self, tmp_path: Path) -> None:
        # 不存 check 就没法重新验算，编辑功能等于废掉
        out = self._file(tmp_path, [_p(id="a")])
        got = json.loads(Path(out).read_text(encoding="utf-8"))[0]
        assert got["check"]["kind"] == "solve"
        assert got["check"]["claimed_roots"] == ["2", "3"]

    def test_改成人工确认会降级为黄(self, tmp_path: Path) -> None:
        out = self._file(tmp_path, [_p(id="a")])
        edited = _p(id="a", check={"kind": "manual", "reason": "改成开放题了"})
        r = save_problems([edited], out, mode="replace_one")
        assert r["ok"] and r["yellow"] == 1
        got = json.loads(Path(out).read_text(encoding="utf-8"))[0]
        assert got["verify"]["status"] == "yellow"

    def test_replace_one一次只能一道(self, tmp_path: Path) -> None:
        out = self._file(tmp_path, [_p(id="a")])
        r = save_problems([_p(id="a"), _p(id="b")], out, mode="replace_one")
        assert not r["ok"] and any("一次只能" in e for e in r["errors"])
