r"""准备 vendor/pandoc —— 随包分发的 pandoc.exe。

## 为什么要有这个脚本

pandoc 是产品的硬需求，不是可选增强：它负责把 $...$ 里的 LaTeX 转成 Word
原生公式对象（OMML）。公式一旦变成图片，教研组改不了，产品当场失去意义
（docs/architecture.md 第七节）。

原先这一步是「手工下载解压放到 vendor/pandoc/」（vendor/README.md）。
手工那条路在 CI 里根本走不通，而且本机和 CI 装的版本会悄悄分叉——
docx writer 的行为是跟版本走的，分叉了就等于发版前验的不是发出去的那份。

## 只取 pandoc.exe

zip 里还有 pandoc-lua.exe / pandoc-server.exe 和一堆文档，
export.py 只调 pandoc.exe（`mathtools/export.py: find_pandoc`），其余不进安装包。

## 验证：真转一次带公式的 docx

只跑 `--version` 是不够的——它能证明二进制能执行，证明不了 docx writer 还在
按 OMML 输出。所以这里照 export.py 的真实调用方式转一份，再拆开 docx 确认：

1. word/document.xml 里有 <m:oMath> 对象
2. 没有 word/media/ ——有的话说明公式被渲染成了图片

跑法：
    pnpm vendor:pandoc
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

# 钉死版本，不取 latest：docx writer 的输出跟版本走，
# 本机、CI、老师机器上必须是同一个 pandoc。升级是一次显式的改动。
PANDOC_VERSION = "3.10.2"
ASSET = f"pandoc-{PANDOC_VERSION}-windows-x86_64.zip"
URL = f"https://github.com/jgm/pandoc/releases/download/{PANDOC_VERSION}/{ASSET}"

REPO = Path(__file__).resolve().parents[1]
VENDOR = REPO / "vendor" / "pandoc"
EXE = VENDOR / "pandoc.exe"

# 覆盖初中数学最常见的几种排版：上标、分式、根号、希腊字母。
# 和 tools-py/tests/test_omml.py 验的是同一件事，这里是打包前的那道闸。
SMOKE_MD = r"""# 冒烟

用公式法解 $x^{2}-5x+6=0$：$x=\dfrac{-b\pm\sqrt{\Delta}}{2a}$，得 $x_{1}=2$，$x_{2}=3$。
"""


def log(msg: str) -> None:
    # Windows 控制台默认 GBK，一个 ✓ 就能让脚本在最后一步崩掉——
    # 而那时候活已经干完了，报出来的却是 UnicodeEncodeError
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    print(msg, flush=True)


def installed_version() -> str | None:
    """已装的那份是什么版本；没装或跑不起来都返回 None。"""
    if not EXE.exists():
        return None
    try:
        r = subprocess.run(
            [str(EXE), "--version"], capture_output=True, text=True, timeout=60
        )
    except OSError:
        return None
    if r.returncode != 0:
        return None
    # 第一行形如 "pandoc 3.10.2"
    m = re.match(r"pandoc\s+([\d.]+)", r.stdout.strip())
    return m.group(1) if m else None


def download_and_extract() -> None:
    # zip 缓存在 vendor/ 下（.gitignore 里的 vendor/*.zip），重跑不再走一次网。
    # 200 MB 级别的下载，学校网络下卡住很烦。
    cache = REPO / "vendor" / ASSET
    if cache.exists():
        log(f"[1/2] 用已缓存的 {cache.name}")
        blob = cache.read_bytes()
    else:
        log(f"[1/2] 下载 {URL}")
        with urllib.request.urlopen(URL, timeout=600) as resp:  # noqa: S310 官方地址
            blob = resp.read()
        cache.write_bytes(blob)
    log(f"      {len(blob) / 1024 / 1024:.1f} MB")

    if VENDOR.exists():
        shutil.rmtree(VENDOR)
    VENDOR.mkdir(parents=True)

    with zipfile.ZipFile(cache) as z:
        # 不假设 zip 里的目录名（历史上变过），按文件名找
        names = [n for n in z.namelist() if n.rsplit("/", 1)[-1].lower() == "pandoc.exe"]
        if not names:
            raise SystemExit(f"{ASSET} 里没找到 pandoc.exe，发行包结构可能变了")
        with z.open(names[0]) as src, EXE.open("wb") as dst:
            shutil.copyfileobj(src, dst)
    log(f"      取出 {names[0]} -> {EXE}（{EXE.stat().st_size / 1024 / 1024:.0f} MB）")


def verify() -> None:
    """真转一份带公式的 docx，确认公式是 OMML 而不是图片。"""
    log("[2/2] 转一份带公式的 docx，检查 OMML")
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "smoke.md"
        out = Path(tmp) / "smoke.docx"
        src.write_text(SMOKE_MD, encoding="utf-8")
        # 参数和 export.py 的真实调用保持一致
        r = subprocess.run(
            [str(EXE), str(src), "-f", "markdown", "-t", "docx", "-o", str(out)],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if r.returncode != 0:
            raise SystemExit(f"pandoc 转 docx 失败：\n{r.stderr or r.stdout}")
        if not out.exists():
            raise SystemExit("pandoc 报成功但没有产出 docx")
        with zipfile.ZipFile(out) as z:
            media = [n for n in z.namelist() if n.startswith("word/media/")]
            if media:
                raise SystemExit(f"docx 里有媒体文件 {media}——公式被渲染成了图片")
            xml = z.read("word/document.xml").decode("utf-8")
    count = len(re.findall(r"<m:oMath[ >]", xml))
    if count < 3:
        raise SystemExit(f"只找到 {count} 个 OMML 对象，公式没有被完整转换")
    log(f"      ✓ {count} 个原生公式对象，没有图片")


def main() -> None:
    if sys.platform != "win32":
        raise SystemExit("这个脚本只准备 Windows 的运行时；第一版只发 Windows 客户端")

    have = installed_version()
    if have == PANDOC_VERSION:
        # 已经是钉死的那个版本就不重下重解（200 MB 级别的拷贝，本机重跑很慢），
        # 但验证照跑——「文件在」和「转出来的公式还是 OMML」是两件事
        log(f"[1/2] vendor/pandoc/pandoc.exe 已是 {PANDOC_VERSION}，跳过下载")
    else:
        if have:
            log(f"      已装的是 {have}，要的是 {PANDOC_VERSION}，重下")
        download_and_extract()
        got = installed_version()
        if got != PANDOC_VERSION:
            raise SystemExit(f"装完跑出来的是 {got}，不是 {PANDOC_VERSION}")

    verify()
    log(f"\nvendor/pandoc 就绪（pandoc {PANDOC_VERSION}）。可以 pnpm dist 了。")


if __name__ == "__main__":
    main()
