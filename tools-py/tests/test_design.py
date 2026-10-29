r"""教学设计写入闸门的测试。

机器验不了「这个情境好不好」，但下面几样查得出，而且都是拿到课堂上才露馅的。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from mathtools.design import render_markdown, save_design


def _design(**over: Any) -> dict[str, Any]:
    d: dict[str, Any] = {
        "content": "线段、射线、直线",
        "learnerAnalysis": "小学已直观认识线段，但符号表示是新的。",
        "objectives": [{"id": "o1", "text": "抽象出线段、射线、直线"}, {"id": "o2", "text": "理解两点确定一条直线"}],
        "keyPoints": ["两点确定一条直线"],
        "difficulties": ["结合实例理解基本事实"],
        "path": "生活经验 → 抽象概念 → 表示 → 基本事实",
        "intro": "今天我们开始系统地学习平面图形。",
        "stages": [
            {
                "id": "s1",
                "title": "创设情境，形成概念",
                "objectiveIds": ["o1"],
                "blocks": [
                    {"kind": "问题", "text": "图中有哪些熟悉的图形？"},
                    {"kind": "追问", "text": "琴弦为什么可以看作线段？"},
                    {"kind": "设计意图", "text": "从现实情境中抽象概念。"},
                ],
            },
            {
                "id": "s2",
                "title": "回归生活，深化概念",
                "objectiveIds": ["o2"],
                "blocks": [
                    {"kind": "问题", "text": "固定木条需要几个钉子？"},
                    {"kind": "题目", "problemId": "e1"},
                    {"kind": "设计意图", "text": "用生活经验理解基本事实。"},
                ],
            },
        ],
        "boardPlan": "",
    }
    d.update(over)
    return d


def _lesson(tmp: Path, problem_ids: tuple[str, ...] = ("e1",)) -> Path:
    problems = [
        {"id": pid, "stem": f"题 {pid}", "answer": "1", "usage": "例题", "verify": {"status": "yellow"}}
        for pid in problem_ids
    ]
    (tmp / "problems.json").write_text(json.dumps(problems, ensure_ascii=False), encoding="utf-8")
    return tmp / "design.json"


def test_合格的教学设计能写盘(tmp_path: Path) -> None:
    out = _lesson(tmp_path)
    r = save_design(str(out), design=_design())
    assert r["ok"], r
    saved = json.loads(out.read_text(encoding="utf-8"))
    assert saved["updatedAt"] and len(saved["stages"]) == 2
    assert "e1" in r["note"]  # 引用了黄题要告诉 Agent


def test_引用不存在的题被拒收(tmp_path: Path) -> None:
    out = _lesson(tmp_path, problem_ids=())
    r = save_design(str(out), design=_design())
    assert not r["ok"]
    assert any("e1" in e and "save_problems" in e for e in r["errors"])
    assert not out.exists()


def test_环节没有设计意图被拒收(tmp_path: Path) -> None:
    d = _design()
    d["stages"][0]["blocks"] = [b for b in d["stages"][0]["blocks"] if b["kind"] != "设计意图"]
    r = save_design(str(_lesson(tmp_path)), design=d)
    assert not r["ok"]
    assert any("第 1 个环节没有设计意图" in e for e in r["errors"])


def test_没有环节落实的教学目标被拒收(tmp_path: Path) -> None:
    d = _design()
    d["objectives"].append({"id": "o3", "text": "发展几何直观"})
    r = save_design(str(_lesson(tmp_path)), design=d)
    assert not r["ok"]
    assert any("o3" in e for e in r["errors"])


def test_只改一个环节不动别的(tmp_path: Path) -> None:
    out = _lesson(tmp_path)
    save_design(str(out), design=_design())
    new = {
        "id": "s1",
        "title": "重写的环节",
        "objectiveIds": ["o1"],
        "blocks": [{"kind": "情境", "text": "新情境"}, {"kind": "设计意图", "text": "新意图"}],
    }
    r = save_design(str(out), stage=new)
    assert r["ok"], r
    saved = json.loads(out.read_text(encoding="utf-8"))
    assert saved["stages"][0]["title"] == "重写的环节"
    assert saved["stages"][1]["title"] == "回归生活，深化概念"


def test_改环节时坏了就整份不写(tmp_path: Path) -> None:
    out = _lesson(tmp_path)
    save_design(str(out), design=_design())
    before = out.read_text(encoding="utf-8")
    bad = {"id": "s1", "title": "x", "objectiveIds": ["o1"], "blocks": [{"kind": "情境", "text": "无意图"}]}
    assert not save_design(str(out), stage=bad)["ok"]
    assert out.read_text(encoding="utf-8") == before


def test_导出时问题连续编号追问逐题重编(tmp_path: Path) -> None:
    problems = [{"id": "e1", "stem": "如图，数一数线段", "answer": "3", "usage": "例题"}]
    md = render_markdown(_design(), problems, "线段、射线、直线")
    assert "### 环节一　创设情境，形成概念" in md
    assert "**问题 1**" in md and "**问题 2**" in md
    assert "**追问 1**" in md
    assert "**例题**　如图，数一数线段" in md
