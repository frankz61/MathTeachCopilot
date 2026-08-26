"""几何作图 —— 带条件校验。

## 为什么不能只是「画个三角形」

docs/grok.md 第五节的红线：**图与题干条件必须同源生成**。

几何题最典型的翻车方式是：题干写「∠C=90°，AC=3，BC=4」，画出来却是个钝角三角形。
学生照着图量，越量越错。模型自己描述、自己画，对不对没人管。

所以这里的做法是：模型必须给出**坐标**，同时把题干里的条件写成 assert 列表
（哪条边多长、哪个角多少度、哪两条线平行）。本模块按坐标**实算**一遍，
对不上就拒绝出图并说明差多少——不画错图，也不假装画对了。

坐标是模型给的，但「坐标是否满足题干条件」是算出来的，不是它说了算。
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402

plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

Point = tuple[float, float]
TOL = 1e-6


def _vec(a: Point, b: Point) -> Point:
    return (b[0] - a[0], b[1] - a[1])


def _length(a: Point, b: Point) -> float:
    return math.hypot(b[0] - a[0], b[1] - a[1])


def _angle_deg(vertex: Point, p1: Point, p2: Point) -> float:
    """在 vertex 处，射线 vertex→p1 与 vertex→p2 的夹角（度）"""
    v1, v2 = _vec(vertex, p1), _vec(vertex, p2)
    n1, n2 = math.hypot(*v1), math.hypot(*v2)
    if n1 < TOL or n2 < TOL:
        return float("nan")
    cos = max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)))
    return math.degrees(math.acos(cos))


def _cross(v1: Point, v2: Point) -> float:
    return v1[0] * v2[1] - v1[1] * v2[0]


# --------------------------------------------------------------------------
# 条件校验：题干说什么，坐标就得是什么
# --------------------------------------------------------------------------


# 每种条件的正确写法。报错时原样贴给模型——只说「写错了」而不给正确形状，
# 它只能靠猜，而猜错的代价是整道题放弃配图。
_ASSERT_SHAPES: dict[str, str] = {
    "length": '{"type": "length", "of": ["A", "B"], "equals": 4}',
    "angle": '{"type": "angle", "at": "C", "rays": ["A", "B"], "equals": 90}',
    "parallel": '{"type": "parallel", "of": [["A", "B"], ["C", "D"]]}',
    "equal_length": '{"type": "equal_length", "of": [["A", "B"], ["C", "D"]]}',
    "collinear": '{"type": "collinear", "of": ["A", "B", "C"]}',
}

# 写错时最常见的几个别名 → 正确的键名。
#
# 这几个不是凭空列的：MCP 那层的参数叫 geo_points，条件里却要写 of / at / rays，
# 命名本身就在诱导人往 points / value / kind 上写（本仓库的作者第一次调也写错了）。
_ASSERT_KEY_ALIASES: dict[str, str] = {
    "kind": "type",
    "value": "equals",
    "equal": "equals",
    "points": "of / at+rays（看是哪种条件）",
    "of_points": "of",
    "vertex": "at",
    "at_point": "at",
}


def check_assert_shapes(asserts: list[dict[str, Any]]) -> list[str]:
    """条件**写法**对不对。和条件成不成立是两码事，必须分开报。

    分开的理由是两种错的修法完全相反：形状写错了要改写法，条件不成立要改坐标。
    混在一起报会把模型往死路上推——实测把 type 写成 kind 时，它收到的是
    「第 1 条条件：未知的条件类型 None」外加一句「调整 points 的坐标，
    不要删掉 asserts 蒙混过关」。照着调坐标调一百次也修不好，
    而工具还顺带指控它想作弊。合理的下一步就只剩「这题不配图了」——
    这正是 81 道题里只有 15 道带图的原因之一。
    """
    errs: list[str] = []
    for i, a in enumerate(asserts):
        where = f"第 {i + 1} 条条件"
        if not isinstance(a, dict):
            errs.append(f"{where}：应该是一个对象，收到的是 {type(a).__name__}")
            continue

        kind = a.get("type")
        if kind is None:
            # 先看是不是键名写错了——这比「缺少 type」有用得多
            wrong = [k for k in a if k in _ASSERT_KEY_ALIASES]
            if wrong:
                fixes = "、".join(f"{k} → {_ASSERT_KEY_ALIASES[k]}" for k in wrong)
                errs.append(f"{where}：键名写错了（{fixes}）")
            else:
                errs.append(f"{where}：缺少 type")
            continue

        if kind not in _ASSERT_SHAPES:
            errs.append(
                f"{where}：没有 type={kind!r} 这种条件，"
                f"只支持 {'、'.join(_ASSERT_SHAPES)}"
            )
            continue

        # 类型对了，再看这一种需要的键齐不齐
        need = {"length": ["of", "equals"], "angle": ["at", "rays", "equals"]}.get(
            str(kind), ["of"]
        )
        missing = [k for k in need if a.get(k) is None]
        if missing:
            alias_hint = ""
            wrong = [k for k in a if k in _ASSERT_KEY_ALIASES]
            if wrong:
                alias_hint = "（是不是把 " + "、".join(
                    f"{k} 当成了 {_ASSERT_KEY_ALIASES[k]}" for k in wrong
                ) + "？）"
            errs.append(f"{where}：type={kind} 缺少 {'、'.join(missing)}{alias_hint}")

    if errs:
        errs.append("正确写法：" + " / ".join(_ASSERT_SHAPES.values()))
    return errs


def check_assertions(
    pts: dict[str, Point], asserts: list[dict[str, Any]], tol: float = 0.01
) -> list[str]:
    """返回不满足的条件说明。空列表 = 图与题干一致。"""
    errs: list[str] = []

    def get(name: str) -> Point | None:
        p = pts.get(name)
        if p is None:
            errs.append(f"条件里用到了点 {name}，但 points 里没有定义它")
        return p

    for i, a in enumerate(asserts):
        kind = a.get("type")
        where = f"第 {i + 1} 条条件"

        if kind == "length":
            of = a.get("of") or []
            if len(of) != 2:
                errs.append(f"{where}：length 需要 of=[点A, 点B]")
                continue
            p, q = get(of[0]), get(of[1])
            if p is None or q is None:
                continue
            actual = _length(p, q)
            want = float(a.get("equals", 0))
            if abs(actual - want) > tol * max(1.0, abs(want)):
                errs.append(f"{where}：{of[0]}{of[1]} 应为 {want}，坐标算出来是 {actual:.4g}")

        elif kind == "angle":
            at, rays = a.get("at"), a.get("rays") or []
            if not at or len(rays) != 2:
                errs.append(f"{where}：angle 需要 at=顶点, rays=[点1, 点2]")
                continue
            v, p1, p2 = get(at), get(rays[0]), get(rays[1])
            if v is None or p1 is None or p2 is None:
                continue
            actual = _angle_deg(v, p1, p2)
            want = float(a.get("equals", 0))
            if math.isnan(actual):
                errs.append(f"{where}：∠{rays[0]}{at}{rays[1]} 算不出来（有点重合）")
            elif abs(actual - want) > max(tol * 100, 0.05):
                errs.append(
                    f"{where}：∠{rays[0]}{at}{rays[1]} 应为 {want}°，坐标算出来是 {actual:.4g}°"
                )

        elif kind == "parallel":
            of = a.get("of") or []
            if len(of) != 2 or any(len(seg) != 2 for seg in of):
                errs.append(f"{where}：parallel 需要 of=[[A,B],[C,D]]")
                continue
            pa, pb, pc, pd = (get(of[0][0]), get(of[0][1]), get(of[1][0]), get(of[1][1]))
            if None in (pa, pb, pc, pd):
                continue
            c = _cross(_vec(pa, pb), _vec(pc, pd))  # type: ignore[arg-type]
            scale = _length(pa, pb) * _length(pc, pd)  # type: ignore[arg-type]
            if scale > TOL and abs(c) / scale > tol:
                errs.append(
                    f"{where}：{of[0][0]}{of[0][1]} 与 {of[1][0]}{of[1][1]} 不平行（叉积 {c:.4g}）"
                )

        elif kind == "equal_length":
            of = a.get("of") or []
            if len(of) != 2 or any(len(seg) != 2 for seg in of):
                errs.append(f"{where}：equal_length 需要 of=[[A,B],[C,D]]")
                continue
            pa, pb, pc, pd = (get(of[0][0]), get(of[0][1]), get(of[1][0]), get(of[1][1]))
            if None in (pa, pb, pc, pd):
                continue
            l1 = _length(pa, pb)  # type: ignore[arg-type]
            l2 = _length(pc, pd)  # type: ignore[arg-type]
            if abs(l1 - l2) > tol * max(1.0, l1):
                errs.append(
                    f"{where}：{of[0][0]}{of[0][1]}={l1:.4g} 与 "
                    f"{of[1][0]}{of[1][1]}={l2:.4g} 不相等"
                )

        elif kind == "collinear":
            of = a.get("of") or []
            if len(of) < 3:
                errs.append(f"{where}：collinear 需要至少 3 个点")
                continue
            got = [get(n) for n in of]
            if any(p is None for p in got):
                continue
            base = _vec(got[0], got[1])  # type: ignore[arg-type]
            for p in got[2:]:
                c = _cross(base, _vec(got[0], p))  # type: ignore[arg-type]
                if abs(c) > tol * max(1.0, math.hypot(*base)):
                    errs.append(f"{where}：{'、'.join(of)} 不共线")
                    break
        else:
            errs.append(f"{where}：未知的条件类型 {kind!r}")

    return errs


# --------------------------------------------------------------------------
# 出图
# --------------------------------------------------------------------------


def render(
    points: dict[str, list[float]],
    segments: list[list[str]] | None = None,
    circles: list[dict[str, Any]] | None = None,
    labels: list[dict[str, Any]] | None = None,
    right_angles: list[dict[str, Any]] | None = None,
    asserts: list[dict[str, Any]] | None = None,
    out_path: str = "assets/geo.svg",
    title: str = "",
) -> dict[str, Any]:
    try:
        pts: dict[str, Point] = {k: (float(v[0]), float(v[1])) for k, v in points.items()}
    except Exception as e:
        return {"ok": False, "error": f"points 格式不对：{e}"}
    if not pts:
        return {"ok": False, "error": "至少要给一个点"}

    # 形状先于内容。写法错了就不该报「坐标对不上」——那句话会让模型去调坐标，
    # 而它真正要做的是改写法，两件事的修法正好相反。
    shape_errs = check_assert_shapes(asserts or [])
    if shape_errs:
        return {
            "ok": False,
            "error": "asserts 的写法不对，还没开始校验图形",
            "violations": shape_errs,
            "hint": "按上面的正确写法改 asserts 的键名，坐标不用动。",
        }

    # 再校验再画。对不上就不画——宁可没图，不可有错图。
    violations = check_assertions(pts, asserts or [])
    if violations:
        return {
            "ok": False,
            "error": "图与题干条件对不上，已拒绝出图",
            "violations": violations,
            "hint": "调整 points 的坐标让它满足题干条件，或者改题干。不要删掉 asserts 蒙混过关——那样画出来的图会误导学生。",
        }

    fig, ax = plt.subplots(figsize=(4.2, 4.2))
    ax.set_aspect("equal")
    ax.axis("off")

    for seg in segments or []:
        if len(seg) != 2 or seg[0] not in pts or seg[1] not in pts:
            plt.close(fig)
            return {"ok": False, "error": f"线段 {seg} 引用了不存在的点"}
        a, b = pts[seg[0]], pts[seg[1]]
        ax.plot([a[0], b[0]], [a[1], b[1]], color="black", linewidth=1.6, zorder=2)

    for c in circles or []:
        center = c.get("center")
        if center not in pts:
            plt.close(fig)
            return {"ok": False, "error": f"圆心 {center} 不存在"}
        cx, cy = pts[center]
        if "radius" in c:
            r = float(c["radius"])
        elif c.get("through") in pts:
            r = _length(pts[center], pts[c["through"]])
        else:
            plt.close(fig)
            return {"ok": False, "error": "圆需要 radius 或 through（圆上一点）"}
        ax.add_patch(plt.Circle((cx, cy), r, fill=False, color="black", linewidth=1.6, zorder=2))

    # 写错形状被跳过的装饰项。**必须报出来**：直角标记和边长标注写错时静默丢弃，
    # 出来的图看着挺正常，只是少了直角符号和「AC=3」——模型以为标了，
    # 老师以为模型没标，谁都不知道是形状写错了。
    ignored: list[str] = []

    # 直角标记：在顶点处画一个小方块
    for i, ra in enumerate(right_angles or []):
        at, rays = ra.get("at"), ra.get("rays") or []
        if at not in pts or len(rays) != 2 or any(r not in pts for r in rays):
            ignored.append(
                f"right_angles 第 {i + 1} 项被忽略："
                f'需要 {{"at": "C", "rays": ["A", "B"]}}，且三个点都要在 points 里'
            )
            continue
        v = pts[at]
        size = max(_length(v, pts[rays[0]]), _length(v, pts[rays[1]])) * 0.12
        u1, u2 = _vec(v, pts[rays[0]]), _vec(v, pts[rays[1]])
        n1, n2 = math.hypot(*u1) or 1, math.hypot(*u2) or 1
        d1 = (u1[0] / n1 * size, u1[1] / n1 * size)
        d2 = (u2[0] / n2 * size, u2[1] / n2 * size)
        corner = [
            (v[0] + d1[0], v[1] + d1[1]),
            (v[0] + d1[0] + d2[0], v[1] + d1[1] + d2[1]),
            (v[0] + d2[0], v[1] + d2[1]),
        ]
        ax.plot([p[0] for p in corner], [p[1] for p in corner], color="black", linewidth=1.1)

    # 点名：往图形外侧偏移，免得压在线上
    cx = sum(p[0] for p in pts.values()) / len(pts)
    cy = sum(p[1] for p in pts.values()) / len(pts)
    span = max(
        max(p[0] for p in pts.values()) - min(p[0] for p in pts.values()),
        max(p[1] for p in pts.values()) - min(p[1] for p in pts.values()),
        1.0,
    )
    for name, (x, y) in pts.items():
        dx, dy = x - cx, y - cy
        n = math.hypot(dx, dy) or 1
        off = span * 0.07
        ax.plot([x], [y], marker="o", markersize=3.5, color="black", zorder=3)
        ax.annotate(
            name, (x + dx / n * off, y + dy / n * off), ha="center", va="center", fontsize=11
        )

    # 边上的标注（长度、角度等）
    for i, lb in enumerate(labels or []):
        on, text = lb.get("on") or [], str(lb.get("text", ""))
        if len(on) != 2 or any(p not in pts for p in on) or not text:
            ignored.append(
                f"labels 第 {i + 1} 项被忽略："
                f'需要 {{"on": ["A", "C"], "text": "3"}}，两个点都要在 points 里'
            )
            continue
        a, b = pts[on[0]], pts[on[1]]
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        dx, dy = mx - cx, my - cy
        n = math.hypot(dx, dy) or 1
        off = span * 0.06
        ax.annotate(
            text,
            (mx + dx / n * off, my + dy / n * off),
            ha="center",
            va="center",
            fontsize=10,
            color="#333",
        )

    if title:
        ax.set_title(title, fontsize=11)

    xs = [p[0] for p in pts.values()]
    ys = [p[1] for p in pts.values()]
    for c in circles or []:
        if c.get("center") in pts:
            cx0, cy0 = pts[c["center"]]
            r = float(c["radius"]) if "radius" in c else _length(pts[c["center"]], pts[c["through"]])
            xs += [cx0 - r, cx0 + r]
            ys += [cy0 - r, cy0 + r]
    pad = span * 0.22
    ax.set_xlim(min(xs) - pad, max(xs) + pad)
    ax.set_ylim(min(ys) - pad, max(ys) + pad)

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, format="svg", bbox_inches="tight", transparent=True)
    plt.close(fig)

    result: dict[str, Any] = {
        "ok": True,
        "path": str(out),
        "checked": len(asserts or []),
        "note": f"已按 {len(asserts or [])} 条题干条件校验坐标，图与条件一致",
    }
    # 图出来了，但有装饰项没画上。不当失败处理（图本身是对的），
    # 但必须让调用方看见——否则「标注怎么没了」根本无从查起。
    if ignored:
        result["ignored"] = ignored
        result["note"] += f"；但有 {len(ignored)} 项标注被忽略，见 ignored"
    return result
