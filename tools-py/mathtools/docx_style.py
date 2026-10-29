"""导出 Word 的字体。

pandoc 默认的样式模板用主题字体（英文 Cambria/Calibri，中文落到系统兜底），
导出来的教案和作业在中文 Windows 上是宋体配 Cambria，老师嫌难看。

做法是取 pandoc 自带的 reference.docx，把样式里所有**主题字体**引用换成
显式的微软雅黑，再交给 `--reference-doc`。等宽字体（代码）保持 Consolas 不动。
公式是 OMML，走 Cambria Math，不受这里影响。
"""

from __future__ import annotations

import re
import subprocess
import zipfile
from pathlib import Path

FONT_LATIN = "Microsoft YaHei"
FONT_EAST_ASIA = "微软雅黑"

_THEME_FONTS = re.compile(r"<w:rFonts\b[^>]*[Tt]heme[^>]*/>")
_EXPLICIT = (
    f'<w:rFonts w:ascii="{FONT_LATIN}" w:hAnsi="{FONT_LATIN}" '
    f'w:eastAsia="{FONT_EAST_ASIA}" w:cs="{FONT_LATIN}" />'
)


def set_fonts(styles_xml: str) -> str:
    """把 styles.xml 里引用主题字体的 rFonts 全部换成微软雅黑。"""
    return _THEME_FONTS.sub(_EXPLICIT, styles_xml)


def build_reference_docx(pandoc: str, dest: Path) -> Path | None:
    """生成字体为微软雅黑的 reference.docx 写到 dest。

    失败返回 None——字体不对只是不好看，不该让导出本身失败，
    调用方拿到 None 就不加 --reference-doc。
    """
    try:
        proc = subprocess.run(
            [pandoc, "--print-default-data-file", "reference.docx"],
            capture_output=True,
            timeout=30,
        )
        if proc.returncode != 0 or not proc.stdout:
            return None
        base = dest.with_name(dest.stem + "-base.docx")
        base.write_bytes(proc.stdout)
        with zipfile.ZipFile(base) as src, zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as out:
            for item in src.infolist():
                data = src.read(item.filename)
                if item.filename == "word/styles.xml":
                    patched = set_fonts(data.decode("utf-8"))
                    if patched == data.decode("utf-8"):
                        return None  # 没替换到任何东西，说明模板结构变了，别假装改过
                    data = patched.encode("utf-8")
                out.writestr(item, data)
        return dest
    except Exception:
        return None


def reference_args(pandoc: str, workdir: Path) -> list[str]:
    ref = build_reference_docx(pandoc, workdir / "reference.docx")
    return ["--reference-doc", str(ref)] if ref else []
