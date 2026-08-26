r"""homework.md 的生成。

核心不变式：**它是 problems.json 的派生视图，不能过期**。
老师删掉一道题之后，手上那张要发给学生的卷子必须跟着变——
这是所有 bug 里后果最实的一种：错的卷子会真的印出来发到学生手上。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from mathtools.homework import MARKER, figure_lines, regenerate, render


def _p(pid: str, tier: str = "A", status: str = "green", **over: Any) -> dict[str, Any]:
    d: dict[str, Any] = {
        "id": pid,
        "stem": f"第 {pid} 题：解方程 $x^2=4$。",
        "answer": "$x=\\pm 2$",
        "solution": ["开平方", "得两根"],
        "tier": tier,
        "type": "解答",
        "figureRefs": [],
        "verify": {"status": status, "log": "", "paths": []},
    }
    d.update(over)
    return d


def _lesson(tmp: Path, problems: list[dict], lesson_name: str = "公式法") -> Path:
    (tmp / "problems.json").write_text(json.dumps(problems, ensure_ascii=False), encoding="utf-8")
    (tmp / "meta.json").write_text(
        json.dumps({"lesson": lesson_name}, ensure_ascii=False), encoding="utf-8"
    )
    return tmp


class Test不会过期:
    def test_题目变了作业纸跟着变(self, tmp_path: Path) -> None:
        d = _lesson(tmp_path, [_p("p1"), _p("p2")])
        regenerate(d)
        assert "第 p2 题" in (d / "homework.md").read_text(encoding="utf-8")

        # 老师删掉一道
        (d / "problems.json").write_text(
            json.dumps([_p("p1")], ensure_ascii=False), encoding="utf-8"
        )
        r = regenerate(d)
        assert r["changed"]
        text = (d / "homework.md").read_text(encoding="utf-8")
        assert "第 p2 题" not in text, "删掉的题还印在卷子上"
        assert "第 p1 题" in text

    def test_内容没变时不重写(self, tmp_path: Path) -> None:
        d = _lesson(tmp_path, [_p("p1")])
        assert regenerate(d)["changed"] is True
        # 第二次必须 changed=False，否则文件监听会自激成死循环
        assert regenerate(d)["changed"] is False


class Test闸门口径一致:
    def test_红色题不进作业纸(self, tmp_path: Path) -> None:
        d = _lesson(tmp_path, [_p("good"), _p("bad", status="red")])
        regenerate(d)
        text = (d / "homework.md").read_text(encoding="utf-8")
        assert "第 bad 题" not in text
        assert "1 道题未通过验算" in text, "排除了却不告诉老师"

    def test_黄色题会进作业纸(self, tmp_path: Path) -> None:
        # 黄 = 检查器覆盖不到，不是错。和导出闸门同一条规则。
        d = _lesson(tmp_path, [_p("p1", status="yellow")])
        regenerate(d)
        assert "第 p1 题" in (d / "homework.md").read_text(encoding="utf-8")

    def test_一道能用的都没有(self, tmp_path: Path) -> None:
        d = _lesson(tmp_path, [_p("p1", status="red")])
        regenerate(d)
        assert "还没有可用的题目" in (d / "homework.md").read_text(encoding="utf-8")


class Test分层与编号:
    def test_按ABC分组且连续编号(self, tmp_path: Path) -> None:
        d = _lesson(tmp_path, [_p("c1", "C"), _p("a1", "A"), _p("b1", "B"), _p("a2", "A")])
        regenerate(d)
        text = (d / "homework.md").read_text(encoding="utf-8")
        assert text.index("## A 基础") < text.index("## B 提升") < text.index("## C 拓展")
        for i in (1, 2, 3, 4):
            assert f"**{i}.**" in text

    def test_空的层不出现(self, tmp_path: Path) -> None:
        d = _lesson(tmp_path, [_p("a1", "A")])
        text_path = d / "homework.md"
        regenerate(d)
        assert "## B 提升" not in text_path.read_text(encoding="utf-8")


class Test插图去重:
    def test_题干已引用的图不再重复输出(self) -> None:
        p = _p("p1", stem="如图 ![](assets/t.svg)，求 $x$。", figureRefs=["assets/t.svg"])
        assert figure_lines(p) == [], "同一张图会印两遍"

    def test_题干没引用的图会补上(self) -> None:
        p = _p("p1", stem="求 $x$。", figureRefs=["assets/t.svg"])
        assert figure_lines(p) == ["![](assets/t.svg)", ""]

    def test_端到端不重复(self, tmp_path: Path) -> None:
        d = _lesson(
            tmp_path,
            [_p("p1", stem="如图 ![](assets/t.svg)，求 $x$。", figureRefs=["assets/t.svg"])],
        )
        regenerate(d)
        assert (d / "homework.md").read_text(encoding="utf-8").count("assets/t.svg") == 1


class Test老师的定制:
    def test_preamble被插到最前面(self, tmp_path: Path) -> None:
        d = _lesson(tmp_path, [_p("p1")])
        (d / "preamble.md").write_text("姓名____ 班级____", encoding="utf-8")
        regenerate(d)
        text = (d / "homework.md").read_text(encoding="utf-8")
        assert "姓名____ 班级____" in text
        assert text.index("姓名") < text.index("## A 基础")

    def test_重新生成不会丢掉preamble(self, tmp_path: Path) -> None:
        d = _lesson(tmp_path, [_p("p1")])
        (d / "preamble.md").write_text("班级公约", encoding="utf-8")
        regenerate(d)
        (d / "problems.json").write_text(
            json.dumps([_p("p1"), _p("p2")], ensure_ascii=False), encoding="utf-8"
        )
        regenerate(d)
        assert "班级公约" in (d / "homework.md").read_text(encoding="utf-8")

    def test_老师整个重写过就不覆盖(self, tmp_path: Path) -> None:
        d = _lesson(tmp_path, [_p("p1")])
        (d / "homework.md").write_text("# 我自己排的版，别动", encoding="utf-8")
        r = regenerate(d)
        assert r.get("skipped") is True
        assert (d / "homework.md").read_text(encoding="utf-8") == "# 我自己排的版，别动"

    def test_带生成标记的可以覆盖(self, tmp_path: Path) -> None:
        d = _lesson(tmp_path, [_p("p1")])
        regenerate(d)
        (d / "problems.json").write_text(
            json.dumps([_p("p1"), _p("p2")], ensure_ascii=False), encoding="utf-8"
        )
        assert regenerate(d)["changed"] is True


class Test健壮性:
    def test_没有problems文件(self, tmp_path: Path) -> None:
        r = regenerate(tmp_path)
        assert not r["ok"] and "找不到" in r["error"]

    def test_problems损坏(self, tmp_path: Path) -> None:
        (tmp_path / "problems.json").write_text("{坏", encoding="utf-8")
        r = regenerate(tmp_path)
        assert not r["ok"] and "解析失败" in r["error"]

    def test_标题取自meta(self, tmp_path: Path) -> None:
        d = _lesson(tmp_path, [_p("p1")], lesson_name="21.2.2 公式法")
        regenerate(d)
        assert "# 21.2.2 公式法 · 分层作业" in (d / "homework.md").read_text(encoding="utf-8")

    def test_生成标记始终在第一行(self, tmp_path: Path) -> None:
        d = _lesson(tmp_path, [_p("p1")])
        regenerate(d)
        assert (d / "homework.md").read_text(encoding="utf-8").startswith(MARKER)

    def test_render不依赖文件系统(self) -> None:
        text = render([_p("p1")], "标题", "抬头")
        assert "标题" in text and "抬头" in text
