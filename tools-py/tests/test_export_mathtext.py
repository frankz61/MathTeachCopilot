r"""导出 Word 时公式写法的兜底：每条都是老师导出的教学设计里真实出过的样子。

不靠存盘时的修正——这里直接把旧的、没修过的写法塞进 design.json 导出，
确认 Word 里没有一个 `$` 或 `\\` 漏成字面文字。
"""

from __future__ import annotations

import json
import re
import zipfile
from pathlib import Path

import pytest

from mathtools.design import export_docx, save_design
from mathtools.export import find_pandoc
from mathtools.store import save_problems

needs_pandoc = pytest.mark.skipif(find_pandoc() is None, reason="没有 pandoc")

# 截图里出过问题的原文（JSON 里存的就是这些字符）
BROKEN = [
    r"若关于 $x,y$ 的多项式的次数是 4，则 $k = $____。",
    r"观察下列一列数：$2, 4, 8, 16, 32, \\dots$(1) 写出第 $n$ 个数",
    r"观察下列等式：$1\\times 2 = 2$$2\\times 3 = 6$$3\\times 4 = 12$$\\dots$，第 9 个是（ ）",
    r"单项式 $-\frac{\pi x^2y}{3}$ 的系数是_，次数是_",
]


def _plain(docx: Path) -> str:
    xml = zipfile.ZipFile(docx).read("word/document.xml").decode("utf-8")
    return "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", xml)), xml


def _design(texts: list[str]) -> dict:
    return {
        "content": "c", "learnerAnalysis": "l", "intro": "i", "path": "", "boardPlan":
        "一、概念对比\n| 图形 | 端点数 |\n|---|---|\n| 线段 | 2 |\n二、表示方法\n线段 AB",
        "objectives": [{"id": "o1", "text": "t"}], "keyPoints": ["k"], "difficulties": ["d"],
        "stages": [{"id": "s1", "title": "T", "objectiveIds": ["o1"],
                    "blocks": [*({"kind": "说明", "text": t} for t in texts),
                               {"kind": "设计意图", "text": "x"}]}],
    }


@needs_pandoc
def test_旧的坏写法导出时不漏源码(tmp_path: Path) -> None:
    (tmp_path / "problems.json").write_text("[]", encoding="utf-8")
    # 绕过 save_design 直接写盘：模拟修正上线前存下的旧教案
    (tmp_path / "design.json").write_text(json.dumps(_design(BROKEN), ensure_ascii=False), encoding="utf-8")
    out = tmp_path / "d.docx"
    assert export_docx(tmp_path, str(out), "T")["ok"]
    plain, xml = _plain(out)
    assert "$" not in plain, "有公式没被识别，$ 原样漏进了 Word"
    assert "\\" not in plain, "有 LaTeX 命令原样漏进了 Word"
    assert "次数是_" in plain or "次数是" in plain
    assert len(re.findall(r"<m:oMath[ >]", xml)) >= 8
    # 板书的竖线表格成了真表格，不是一行字
    assert "<w:tbl>" in xml


def test_存盘时把坏写法修掉并告诉模型(tmp_path: Path) -> None:
    (tmp_path / "problems.json").write_text("[]", encoding="utf-8")
    r = save_design(str(tmp_path / "design.json"), design=_design(BROKEN))
    assert r["ok"], r
    assert "autofixed" in r
    saved = json.loads((tmp_path / "design.json").read_text(encoding="utf-8"))
    texts = [b["text"] for b in saved["stages"][0]["blocks"]]
    assert r"$k =$" in texts[0]
    assert r"\\dots" not in texts[1] and r"\dots" in texts[1]
    assert "$$" not in texts[2]


def test_手画框线表格被拒收(tmp_path: Path) -> None:
    (tmp_path / "problems.json").write_text("[]", encoding="utf-8")
    d = _design(["x"])
    d["boardPlan"] = "+——+———+\n| 图形 | 端点数 |\n+——+———+"
    r = save_design(str(tmp_path / "design.json"), design=d)
    assert not r["ok"]
    assert any("竖线表格" in e for e in r["errors"])


def test_题目存盘时修公式_落单的美元符号拒收(tmp_path: Path) -> None:
    base = {"id": "p1", "answer": "$12$", "solution": ["a", "b"], "tier": "A", "type": "填空",
            "check": {"kind": "manual", "reason": "规律题"}}
    out = tmp_path / "problems.json"
    r = save_problems([dict(base, stem=r"$3\\times 4 = $______")], str(out))
    assert r["ok"] and "autofixed" in r, r
    assert json.loads(out.read_text(encoding="utf-8"))[0]["stem"] == r"$3\times 4 =$______"

    r = save_problems([dict(base, id="p2", stem="若 $x=2，则")], str(out), mode="append")
    assert not r["ok"]
    assert any("落单的 $" in e for e in r["errors"])
