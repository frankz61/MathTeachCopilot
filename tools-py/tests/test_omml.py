"""导出的 Word 里，公式必须是 OMML，不能是图片。

这是整个产品最容易在演示时翻车的地方（docs/architecture.md 第七节）：
公式变成图片，教研组改不了，产品当场失去意义。

所以把它锁成回归测试，而不是靠每次人工去 Word 里点一下。
人工那一步仍然要做，但只用来确认「渲染好不好看」，不再用来确认「是不是图片」。
"""

from __future__ import annotations

import re
import zipfile

import pytest

from mathtools.export import export_docx, find_pandoc

pytestmark = pytest.mark.skipif(
    find_pandoc() is None, reason="没有 pandoc，见 vendor/README.md"
)

# 覆盖初中数学最常见的几种排版：上标、下标、分式、根号、希腊字母
STEM = "用公式法解方程 $x^{2}-5x+6=0$。"
ANSWER = "$x_{1}=2$，$x_{2}=3$"
SOLUTION = [
    "$a=1$，$b=-5$，$c=6$",
    r"$\Delta=b^{2}-4ac=25-24=1$",
    r"$x=\dfrac{-b\pm\sqrt{\Delta}}{2a}=\dfrac{5\pm 1}{2}$",
]


@pytest.fixture(scope="module")
def document_xml(tmp_path_factory: pytest.TempPathFactory) -> str:
    out = tmp_path_factory.mktemp("omml") / "t.docx"
    problems = [
        {
            "id": "omml-1",
            "tier": "A",
            "type": "解答",
            "figureRefs": [],
            "stem": STEM,
            "answer": ANSWER,
            "solution": SOLUTION,
            "verify": {"status": "green", "log": "", "paths": []},
        }
    ]
    result = export_docx(problems, str(out), title="OMML 回归测试")
    assert result["ok"], result.get("error")
    with zipfile.ZipFile(out) as z:
        assert not [n for n in z.namelist() if n.startswith("word/media/")], (
            "docx 里出现了媒体文件——公式很可能被渲染成了图片"
        )
        return z.read("word/document.xml").decode("utf-8")


def test_公式变成了原生omml对象(document_xml: str) -> None:
    count = len(re.findall(r"<m:oMath[ >]", document_xml))
    # 题干 1 处 + 答案 2 处 + 解析 3 行共 5 处 = 8 个行内公式
    assert count >= 8, f"只找到 {count} 个 OMML 对象，公式没有被完整转换"


def test_没有把公式画成图片(document_xml: str) -> None:
    assert "<w:drawing" not in document_xml
    assert "<pic:pic" not in document_xml


def test_latex源码没有作为字面文本漏出来(document_xml: str) -> None:
    plain = "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", document_xml))
    for leak in ("$", "\\dfrac", "\\sqrt", "\\Delta", "\\pm", "^{", "_{"):
        assert leak not in plain, f"LaTeX 源码 {leak!r} 以纯文本漏进了文档"


def test_分式与根号被结构化(document_xml: str) -> None:
    # 光有 oMath 不够，要确认复杂结构真的建起来了，而不是退化成一行字符
    assert "<m:f>" in document_xml, "分式没有生成 OMML 分式结构"
    assert "<m:rad>" in document_xml, "根号没有生成 OMML 根式结构"
    assert "<m:sSup>" in document_xml, "上标没有生成 OMML 上标结构"
    assert "<m:sSub>" in document_xml, "下标没有生成 OMML 下标结构"


def test_中文正常保留(document_xml: str) -> None:
    plain = "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", document_xml))
    assert "用公式法解方程" in plain
    assert "参考答案与解析" in plain
