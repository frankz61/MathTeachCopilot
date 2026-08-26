"""统计图：条形图 / 折线图 / 扇形图 / 频数分布直方图。

## 为什么要单独有这一层

原来只有函数图象和数轴。老师让出「统计图表」的题时，Agent 只能拿几何工具硬凑——
而几何渲染器会给每个点标名字（那是几何题需要的：△ABC 得标出 A、B、C），
于是条形统计图上出现了一堆 B2、B3、F2、F3，没有坐标轴、没有类别名、没有数值。
学生根本读不了那种图。

统计图和几何图的画法要求是相反的：几何要标点，统计要标**类别和数值**、藏掉点。

## 数据必须和题干一致

和几何图同一条红线：题干说「乒乓球 16 人」，图上那根柱子就得是 16。
这里的做法比几何简单——数值本来就是画图的输入，不存在「坐标和条件对不上」的空间，
只要 Agent 把题干里的数报进来即可。但**总数**这类容易算错的，可以用 assert_total 校验。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402

plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

# 教材里的统计图配色偏素，别用花哨的默认色轮
BAR_COLOR = "#5b8ff9"
LINE_COLOR = "#2d6cdf"
PIE_COLORS = ["#5b8ff9", "#61ddaa", "#f6bd16", "#f08bb4", "#7262fd", "#78d3f8"]


def _save(fig: plt.Figure, out_path: str) -> str:
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, format="svg", bbox_inches="tight", transparent=True)
    plt.close(fig)
    return str(out)


def _check(labels: list[str], values: list[float], assert_total: float | None) -> str | None:
    if not labels or not values:
        return "labels 和 values 都不能为空"
    if len(labels) != len(values):
        return f"labels 有 {len(labels)} 项，values 有 {len(values)} 项，对不上"
    try:
        nums = [float(v) for v in values]
    except Exception as e:
        return f"values 里有非数字：{e}"
    if any(n < 0 for n in nums):
        return "统计图的数值不能为负"
    if assert_total is not None and abs(sum(nums) - float(assert_total)) > 1e-9:
        return (
            f"各项之和是 {sum(nums):g}，但题干说总数是 {assert_total:g}——"
            "两边对不上，先确定哪个是对的，不要画一张和题干矛盾的图"
        )
    return None


def bar(
    labels: list[str],
    values: list[float],
    out_path: str,
    x_label: str = "",
    y_label: str = "",
    title: str = "",
    show_values: bool = True,
    assert_total: float | None = None,
) -> dict[str, Any]:
    """条形统计图。初中最常见的一种，题目一般要求读出各项人数和总数。"""
    err = _check(labels, values, assert_total)
    if err:
        return {"ok": False, "error": err}

    nums = [float(v) for v in values]
    fig, ax = plt.subplots(figsize=(4.6, 3.4))
    bars = ax.bar(labels, nums, color=BAR_COLOR, width=0.5, zorder=2)

    if show_values:
        for b, v in zip(bars, nums):
            ax.annotate(
                f"{v:g}",
                (b.get_x() + b.get_width() / 2, v),
                textcoords="offset points",
                xytext=(0, 4),
                ha="center",
                fontsize=10,
            )

    ax.set_ylim(0, max(nums) * 1.18 or 1)
    ax.set_xlabel(x_label, fontsize=10)
    ax.set_ylabel(y_label, fontsize=10)
    if title:
        ax.set_title(title, fontsize=11)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", linestyle=":", alpha=0.45, zorder=0)
    ax.tick_params(labelsize=10)

    return {"ok": True, "path": _save(fig, out_path), "total": sum(nums)}


def line(
    labels: list[str],
    values: list[float],
    out_path: str,
    x_label: str = "",
    y_label: str = "",
    title: str = "",
    show_values: bool = True,
    assert_total: float | None = None,
) -> dict[str, Any]:
    """折线统计图。题目一般考「变化趋势」和「相邻两项之差」。"""
    err = _check(labels, values, assert_total)
    if err:
        return {"ok": False, "error": err}

    nums = [float(v) for v in values]
    fig, ax = plt.subplots(figsize=(4.8, 3.4))
    ax.plot(labels, nums, marker="o", markersize=5, linewidth=1.9, color=LINE_COLOR, zorder=2)

    if show_values:
        for x, v in zip(labels, nums):
            ax.annotate(
                f"{v:g}",
                (x, v),
                textcoords="offset points",
                xytext=(0, 7),
                ha="center",
                fontsize=10,
            )

    lo, hi = min(nums), max(nums)
    pad = (hi - lo or hi or 1) * 0.25
    ax.set_ylim(max(0, lo - pad), hi + pad)
    ax.set_xlabel(x_label, fontsize=10)
    ax.set_ylabel(y_label, fontsize=10)
    if title:
        ax.set_title(title, fontsize=11)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", linestyle=":", alpha=0.45, zorder=0)
    ax.tick_params(labelsize=10)

    return {"ok": True, "path": _save(fig, out_path), "total": sum(nums)}


def pie(
    labels: list[str],
    values: list[float],
    out_path: str,
    title: str = "",
    show_percent: bool = True,
    assert_total: float | None = None,
) -> dict[str, Any]:
    """扇形统计图。题目常考「某项占百分之几」和「已知总数求某项」。"""
    err = _check(labels, values, assert_total)
    if err:
        return {"ok": False, "error": err}

    nums = [float(v) for v in values]
    if sum(nums) <= 0:
        return {"ok": False, "error": "各项之和必须大于 0"}

    fig, ax = plt.subplots(figsize=(4.2, 3.6))
    ax.pie(
        nums,
        labels=labels,
        autopct=("%1.0f%%" if show_percent else None),
        colors=PIE_COLORS[: len(nums)] * (len(nums) // len(PIE_COLORS) + 1),
        startangle=90,
        counterclock=False,
        textprops={"fontsize": 10},
        wedgeprops={"edgecolor": "white", "linewidth": 1.2},
    )
    ax.set_aspect("equal")
    if title:
        ax.set_title(title, fontsize=11)

    return {"ok": True, "path": _save(fig, out_path), "total": sum(nums)}


def histogram(
    bin_edges: list[float],
    counts: list[float],
    out_path: str,
    x_label: str = "",
    y_label: str = "频数",
    title: str = "",
    show_values: bool = True,
) -> dict[str, Any]:
    """频数分布直方图。和条形图的区别是柱子相邻不留空，横轴是连续区间。"""
    if len(bin_edges) != len(counts) + 1:
        return {
            "ok": False,
            "error": f"bin_edges 要比 counts 多一个：现在是 {len(bin_edges)} 和 {len(counts)}",
        }
    try:
        edges = [float(e) for e in bin_edges]
        nums = [float(c) for c in counts]
    except Exception as e:
        return {"ok": False, "error": f"数值不合法：{e}"}
    if any(edges[i] >= edges[i + 1] for i in range(len(edges) - 1)):
        return {"ok": False, "error": "bin_edges 必须严格递增"}

    fig, ax = plt.subplots(figsize=(4.8, 3.4))
    for i, c in enumerate(nums):
        ax.bar(
            (edges[i] + edges[i + 1]) / 2,
            c,
            width=edges[i + 1] - edges[i],
            color=BAR_COLOR,
            edgecolor="white",
            linewidth=1.0,
            zorder=2,
        )
        if show_values and c > 0:
            ax.annotate(
                f"{c:g}",
                ((edges[i] + edges[i + 1]) / 2, c),
                textcoords="offset points",
                xytext=(0, 4),
                ha="center",
                fontsize=10,
            )

    ax.set_xticks(edges)
    ax.set_ylim(0, (max(nums) or 1) * 1.18)
    ax.set_xlabel(x_label, fontsize=10)
    ax.set_ylabel(y_label, fontsize=10)
    if title:
        ax.set_title(title, fontsize=11)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", linestyle=":", alpha=0.45, zorder=0)
    ax.tick_params(labelsize=10)

    return {"ok": True, "path": _save(fig, out_path), "total": sum(nums)}
