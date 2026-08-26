r"""准备 vendor/python —— 打包形态下随包分发的 Python 运行时。

## 为什么是官方 embeddable 而不是 PyInstaller

见 docs/architecture.md 第五节：不是体积考虑（体积不是约束），
是 PyInstaller 在 Windows 上常被杀软误报，而且产物不透明、出问题没法进去看。
embeddable 就是一个普通目录，坏了能直接 cd 进去跑 python.exe 调试。

## 这个脚本做四件事

1. 下官方 embeddable zip 并解开到 vendor/python
2. 改 `python3xx._pth`，把 Lib\site-packages 加进搜索路径并打开 site
   （embeddable 默认是关的，不改的话装进去的包一个也 import 不到）
3. 用 uv 把 mcp / sympy / matplotlib 装进 Lib\site-packages
4. **实跑一次 import 验证**——这一步不能省：前三步全部"成功"而运行时
   import 失败是完全可能的（架构不匹配、_pth 写错、wheel 缺 DLL），
   而那时候错误会出现在老师的机器上，表现成「工具进程连不上」。

跑法：
    pnpm vendor:python
"""

from __future__ import annotations

import io
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

# 用 3.12 而不是最新版：numpy / matplotlib 的 wheel 在 3.12 上最齐全，
# 打包时缺一个 wheel 就得回退到源码编译，那在教师机器上是不可能的。
PY_VERSION = "3.12.10"
PY_TAG = "312"
URL = f"https://www.python.org/ftp/python/{PY_VERSION}/python-{PY_VERSION}-embed-amd64.zip"

REPO = Path(__file__).resolve().parents[1]
VENDOR = REPO / "vendor" / "python"
SITE = VENDOR / "Lib" / "site-packages"

# 和 tools-py/pyproject.toml 的 dependencies 保持一致。
# 不自动读 pyproject 是刻意的：那里还有 dev 组（pytest / debugpy），
# 不该进安装包，而"自动同步但要排除某些组"的逻辑比写死更容易出错。
RUNTIME_DEPS = ["mcp>=1.2.0", "sympy>=1.13", "matplotlib>=3.9"]


def log(msg: str) -> None:
    # Windows 控制台默认 GBK，一个 ✓ 就能让整个脚本在最后一步崩掉——
    # 而那时候活其实已经干完了，报出来的却是 UnicodeEncodeError，指不到任何真问题
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    print(msg, flush=True)


def download_and_extract() -> None:
    # zip 缓存在 vendor/ 下，重跑不再走一次网。学校网络差，这一步卡住很烦。
    cache = REPO / "vendor" / f"python-{PY_VERSION}-embed-amd64.zip"
    if cache.exists():
        log(f"[1/4] 用已缓存的 {cache.name}")
        blob = cache.read_bytes()
    else:
        log(f"[1/4] 下载 {URL}")
        with urllib.request.urlopen(URL, timeout=180) as resp:  # noqa: S310 官方地址
            blob = resp.read()
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_bytes(blob)
    log(f"      {len(blob) / 1024 / 1024:.1f} MB")

    if VENDOR.exists():
        log(f"      清掉旧的 {VENDOR}")
        shutil.rmtree(VENDOR)
    VENDOR.mkdir(parents=True)

    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        z.extractall(VENDOR)
    log(f"      解到 {VENDOR}")


def enable_site_packages() -> None:
    """打开 site 并把 Lib\\site-packages 加进搜索路径。

    embeddable 版默认把这两样都关着（`#import site`），装进去的包一个也 import 不到。
    这是这个方案最容易踩的一步，而且症状是运行时 ModuleNotFoundError，
    从"下载解压都成功了"完全看不出来。
    """
    pth = VENDOR / f"python{PY_TAG}._pth"
    if not pth.exists():
        raise SystemExit(f"找不到 {pth.name}，embeddable 包的结构可能变了")
    lines = pth.read_text(encoding="utf-8").splitlines()
    out: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped in ("#import site", "# import site"):
            continue  # 下面统一加
        out.append(line)
    out += [r"Lib\site-packages", "", "import site"]
    pth.write_text("\n".join(out) + "\n", encoding="utf-8")
    log(f"[2/4] 已改 {pth.name}：打开 site，加入 Lib\\site-packages")


def install_deps() -> None:
    SITE.mkdir(parents=True, exist_ok=True)
    log(f"[3/4] 装依赖到 {SITE}")
    cmd = [
        "uv", "pip", "install",
        "--target", str(SITE),
        "--python-version", ".".join(PY_VERSION.split(".")[:2]),
        # 只收 wheel：教师机器上没有编译器，退回源码编译等于装不上。
        # 这里失败要立刻知道，不能拖到打包之后。
        "--only-binary=:all:",
        *RUNTIME_DEPS,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        raise SystemExit(f"依赖安装失败：\n{r.stderr or r.stdout}")
    log("      " + (r.stderr or r.stdout).strip().splitlines()[-1])


def verify() -> None:
    """实跑一次 import。前三步都"成功"而运行时 import 不到是完全可能的。"""
    exe = VENDOR / "python.exe"
    log(f"[4/4] 用 {exe} 实跑一次 import")
    code = (
        "import sys, sympy, matplotlib, mcp;"
        "import matplotlib; matplotlib.use('Agg');"
        "import matplotlib.pyplot as plt;"
        "print(sys.version.split()[0], 'sympy', sympy.__version__, "
        "'matplotlib', matplotlib.__version__)"
    )
    r = subprocess.run(
        [str(exe), "-c", code], capture_output=True, text=True, encoding="utf-8"
    )
    if r.returncode != 0:
        raise SystemExit(f"随包 Python 跑不起来：\n{r.stdout}\n{r.stderr}")
    log(f"      ✓ {r.stdout.strip()}")

    # 再验真正要用的入口，**而且必须照真实调用方式来**：
    #
    #     python.exe <绝对路径>/server.py
    #
    # 第一版这里手动 sys.path.insert 了一下，于是"验证通过"而真跑起来
    # ModuleNotFoundError —— 因为 embeddable 的 ._pth 会关掉「脚本目录自动进
    # sys.path」这个默认行为。**验证一旦和真实调用方式不同，它就只是在自我安慰。**
    server = REPO / "tools-py" / "server.py"
    r2 = subprocess.run(
        [str(exe), str(server)],
        capture_output=True, text=True, encoding="utf-8", timeout=60,
        input="",  # 立刻 EOF：server 读不到请求就收尾，import 错会先炸出来
        env={"PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1", "SystemRoot": r"C:\Windows"},
    )
    err = r2.stderr or ""
    if "ModuleNotFoundError" in err or "ImportError" in err or "Traceback" in err:
        raise SystemExit(f"{server.name} 在随包 Python 下起不来：\n{err[:1500]}")
    log("      ✓ server.py 在随包 Python 下能起来（按真实调用方式）")


def size_of(p: Path) -> str:
    total = sum(f.stat().st_size for f in p.rglob("*") if f.is_file())
    return f"{total / 1024 / 1024:.0f} MB"


def main() -> None:
    if sys.platform != "win32":
        raise SystemExit("这个脚本只准备 Windows 的运行时；第一版只发 Windows 客户端")
    download_and_extract()
    enable_site_packages()
    install_deps()
    verify()
    log(f"\nvendor/python 就绪，{size_of(VENDOR)}。可以 pnpm dist 了。")


if __name__ == "__main__":
    main()
