# vendor —— 随包分发的二进制

体积不是约束（见 docs/architecture.md 的前提），所以这里的东西全部整个塞进安装包，
不做裁剪、不做按需下载。学校网络差，装完就能用比安装包小 100MB 重要得多。

目录内容不进版本库（见 .gitignore），由构建脚本准备。

## pandoc

负责把 Markdown + LaTeX 转成 docx，**公式必须是 OMML**（Word 里可编辑，不是图片）。
这是产品的硬需求，见 docs/architecture.md 第七节。

    vendor/pandoc/pandoc.exe

开发期没有它也能跑其余部分，导出工具会返回一条明确的错误而不是静默失败。
本机开发也可以装到 PATH 上，或用环境变量 `MTC_PANDOC` 指定路径。

下载：https://github.com/jgm/pandoc/releases （Windows x86_64 zip）

## python

打包形态下的 Python 运行时，用官方 embeddable 发行版 + 预装 wheel：

    vendor/python/python.exe
    vendor/python/Lib/site-packages/{sympy,matplotlib,mcp,...}

**不要用 PyInstaller。** 不是体积考虑，是它在 Windows 上常被杀软误报，
而且打包产物不透明、出问题难排查。embeddable 方案就是一个普通目录，坏了能直接进去看。

开发期不需要这个目录：`apps/desktop/src/main/mcp.ts` 找不到它时会自动退回
`uv run --project tools-py`。
