"""作图。输出 SVG，直接嵌 Markdown，导出时带进 Word。

红线（docs/grok.md 第五节）：图与题干条件必须同源生成。
所以这里只接受结构化参数，不接受「画一个直角三角形」这种自然语言描述——
模型描述和实际画出来的东西对不上，是几何题最典型的翻车方式。
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")  # 无 GUI 后端，必须在 pyplot 之前设置

import matplotlib.pyplot as plt  # noqa: E402
import sympy as sp  # noqa: E402

from .verify import _parse  # noqa: E402

# 中文字体：学校机器上普遍有黑体
plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False


def _save_svg(fig: plt.Figure, out_path: Path) -> str:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    buf = io.StringIO()
    fig.savefig(buf, format="svg", bbox_inches="tight", transparent=True)
    plt.close(fig)
    out_path.write_text(buf.getvalue(), encoding="utf-8")
    return str(out_path)


def plot_function(
    expression: str,
    variable: str,
    x_range: tuple[float, float],
    out_path: str,
    title: str | None = None,
) -> dict[str, Any]:
    """函数图象。expression 用 sympy 语法，和题干里的表达式必须是同一个。"""
    try:
        expr = _parse(expression)
        var = sp.Symbol(variable)
        f = sp.lambdify(var, expr, "math")
    except Exception as e:
        return {"ok": False, "error": f"表达式无法解析：{e}"}

    lo, hi = x_range
    xs: list[float] = []
    ys: list[float] = []
    steps = 400
    for i in range(steps + 1):
        x = lo + (hi - lo) * i / steps
        try:
            y = float(f(x))
        except Exception:
            continue  # 该点无定义（如分式的极点），跳过
        if y != y or abs(y) > 1e6:
            continue
        xs.append(x)
        ys.append(y)

    if not xs:
        return {"ok": False, "error": "区间内没有可绘制的点，检查表达式或取值范围"}

    fig, ax = plt.subplots(figsize=(4.5, 3.5))
    ax.plot(xs, ys, linewidth=2)
    ax.axhline(0, color="black", linewidth=0.8)
    ax.axvline(0, color="black", linewidth=0.8)
    ax.grid(True, linestyle=":", alpha=0.5)
    ax.set_xlabel(variable)
    ax.set_ylabel("y")
    if title:
        ax.set_title(title)

    path = _save_svg(fig, Path(out_path))
    return {"ok": True, "path": path, "pointCount": len(xs)}


def plot_number_line(
    points: list[dict[str, Any]],
    out_path: str,
    x_range: tuple[float, float] | None = None,
) -> dict[str, Any]:
    """数轴。points 形如 [{"value": 2, "label": "a", "filled": true}]。"""
    if not points:
        return {"ok": False, "error": "至少要有一个点"}
    try:
        values = [float(p["value"]) for p in points]
    except Exception as e:
        return {"ok": False, "error": f"点的坐标不合法：{e}"}

    lo, hi = x_range if x_range else (min(values) - 2, max(values) + 2)

    fig, ax = plt.subplots(figsize=(5.5, 1.2))
    ax.axhline(0, color="black", linewidth=1.2)
    ax.plot([hi], [0], marker=">", color="black", markersize=8)
    for p, v in zip(points, values):
        filled = bool(p.get("filled", True))
        ax.plot(
            [v],
            [0],
            marker="o",
            markersize=8,
            color="black",
            markerfacecolor="black" if filled else "white",
        )
        if p.get("label"):
            ax.annotate(str(p["label"]), (v, 0), textcoords="offset points", xytext=(0, 10), ha="center")
    ax.set_xlim(lo, hi)
    ax.set_ylim(-0.5, 0.6)
    ax.set_yticks([])
    for side in ("left", "right", "top", "bottom"):
        ax.spines[side].set_visible(False)

    path = _save_svg(fig, Path(out_path))
    return {"ok": True, "path": path}
