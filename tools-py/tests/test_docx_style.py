"""导出 Word 的字体：要真的是微软雅黑，不能只是我们以为改了。"""

from __future__ import annotations

import zipfile
from pathlib import Path

import pytest

from mathtools.design import export_docx as export_design
from mathtools.docx_style import set_fonts
from mathtools.export import export_docx, find_pandoc

needs_pandoc = pytest.mark.skipif(find_pandoc() is None, reason="没有 pandoc")


def test_主题字体被换成微软雅黑_等宽字体不动() -> None:
    src = (
        '<w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia" />'
        '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" />'
    )
    out = set_fonts(src)
    assert "Theme" not in out
    assert 'w:eastAsia="微软雅黑"' in out
    assert 'w:ascii="Consolas"' in out


def _styles(docx: Path) -> str:
    return zipfile.ZipFile(docx).read("word/styles.xml").decode("utf-8")


@needs_pandoc
def test_作业导出的docx用微软雅黑(tmp_path: Path) -> None:
    p = {"id": "a", "stem": "解 $x^2=4$", "answer": "$x=\\pm2$", "solution": ["a", "b"],
         "tier": "A", "verify": {"status": "green"}}
    out = tmp_path / "hw.docx"
    assert export_docx([p], str(out))["ok"]
    styles = _styles(out)
    assert "微软雅黑" in styles and "asciiTheme" not in styles


@needs_pandoc
def test_教学设计导出的docx用微软雅黑(tmp_path: Path) -> None:
    import json

    (tmp_path / "problems.json").write_text("[]", encoding="utf-8")
    (tmp_path / "design.json").write_text(
        json.dumps({"content": "c", "objectives": [], "keyPoints": [], "difficulties": [],
                    "intro": "i", "stages": []}, ensure_ascii=False),
        encoding="utf-8",
    )
    out = tmp_path / "d.docx"
    assert export_design(tmp_path, str(out), "T")["ok"]
    assert "微软雅黑" in _styles(out)
