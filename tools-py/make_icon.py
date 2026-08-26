r"""生成应用图标。

## 为什么是根号

这个产品的核心不是「能出题」——是**每道题都验算过**（三态验证，见
docs/architecture.md §4.1）。而根号 √ 恰好既是数学符号、又长得就是一个对勾。
符号和语义在这里是同一个东西，不用再往上叠一个「AI」或者「书本」的比喻。

## 试过并放弃的：加一个绿色标记

三态验证的绿色很想加进来，试了三版，全都比不过纯字形：

1. 大绿圆压在横线端点上 —— 根号被读成「一根线拴着个球」。
2. 缩小、挪到横线上方 —— 变成了**通知角标**。角标在桌面应用上有确定含义
   （有未读、有状态），用在这儿是主动误导。
3. 把横线末端染绿 —— 硬色界让横线看起来像两段拼起来的。

根号本身已经同时是「数学」和「验证」了，再加绿色是在重复解释一件已经说清的事。
最后留了干净的字形。

## 为什么用 Pillow 直接画，不画 SVG

没有 SVG 光栅化器（cairosvg / rsvg 都不在依赖里），而 matplotlib 依赖 Pillow，
所以 Pillow 是现成的。图形本身是纯几何的，直接画反而更可控——
尤其是**小尺寸要单独调笔画粗细**这件事，从 SVG 缩下来是做不到的。

## 跑法

    pnpm icon

输出：
    apps/desktop/build/icon.ico   —— electron-builder 自动认这个名字
    apps/desktop/build/icon.png   —— 开发期的窗口图标
    apps/desktop/build/icon-preview.png —— 各尺寸拼版，用来肉眼检查
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "apps" / "desktop" / "build"

# 和界面的 --c-accent 同一支蓝，图标和应用里的品牌色不该是两个颜色
ACCENT_TOP = (74, 132, 232)
ACCENT_BOTTOM = (37, 92, 200)
WHITE = (255, 255, 255)

SS = 8  # 超采样倍数。先画大的再缩，是这里唯一能拿到抗锯齿的办法


def rounded_mask(size: int, radius: int) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius, fill=255)
    return m


def gradient(size: int) -> Image.Image:
    """竖直渐变。纯色在小尺寸下会显得很平，渐变能让方块看起来有体积。"""
    g = Image.new("RGB", (1, size))
    px = g.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        px[0, y] = tuple(
            round(a + (b - a) * t) for a, b in zip(ACCENT_TOP, ACCENT_BOTTOM)
        )
    return g.resize((size, size), Image.NEAREST)


def draw_icon(px: int, *, stroke_scale: float = 1.0) -> Image.Image:
    """画一张 px×px 的图标。

    stroke_scale 单独开出来是因为**小尺寸必须加粗**：按比例缩下来的笔画
    到 16px 只剩一根发丝，整个符号糊成一团蓝，认不出是什么。
    """
    n = px * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))

    # 圆角方块 + 渐变
    tile = gradient(n)
    img.paste(tile, (0, 0), rounded_mask(n, round(n * 0.22)))

    d = ImageDraw.Draw(img)
    u = n / 100.0  # 百分比坐标，改设计时好读

    # 根号：小勾 → 长上升笔 → 上横线
    #                                  ↗ 长笔
    #   起笔 ↘ 小勾 ↗                  ────── 横线
    #
    # 坐标是调过的。第一版字形偏小、堆在左下，右下角空一大块，
    # 整个图标看起来像没排版好。现在把它撑开到接近满格，
    # 并让「V」的谷底和横线的高度上下大致等距，视觉上才站得住。
    pts = [(14 * u, 50 * u), (32 * u, 78 * u), (58 * u, 19 * u), (87 * u, 19 * u)]
    w = round(11 * u * stroke_scale)
    d.line(pts, fill=WHITE, width=w, joint="curve")

    # joint="curve" 只处理拐角，端点是平的。补两个圆点当圆头，
    # 否则起笔和收笔看起来像被切了一刀。
    r = w / 2
    for x, y in (pts[0], pts[-1]):
        d.ellipse([x - r, y - r, x + r, y + r], fill=WHITE)

    return img.resize((px, px), Image.LANCZOS)


def build() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    # 越小越要加粗：按比例缩下来的笔画到 16px 只剩一根发丝，
    # 整个符号糊成一团蓝，认不出是什么
    recipes = {16: 1.45, 24: 1.3, 32: 1.2, 48: 1.1, 64: 1.05, 128: 1.0, 256: 1.0}
    layers = {px: draw_icon(px, stroke_scale=sc) for px, sc in recipes.items()}

    big = draw_icon(512)
    big.save(OUT / "icon.png")

    # 多尺寸 ico：Windows 会按显示场景挑最合适的那张，
    # 只塞一张 256 的话，任务栏上是缩出来的，糊
    layers[256].save(
        OUT / "icon.ico",
        format="ICO",
        sizes=[(s, s) for s in sorted(recipes)],
        append_images=[layers[s] for s in sorted(recipes) if s != 256],
    )

    # 拼版预览：图标好不好看只能用眼睛判断，尤其是 16px 那张。
    # 浅底一排、深底一排——任务栏和标题栏两种底色都会遇到，
    # 只在白底上看会漏掉深色下的问题（比如渐变底部太暗、和背景糊在一起）。
    pad, gap = 24, 20
    shown = sorted(recipes)
    width = pad * 2 + sum(shown) + gap * (len(shown) - 1)
    row = max(shown)
    sheet = Image.new("RGBA", (width, pad * 3 + row * 2), (250, 250, 252, 255))
    ImageDraw.Draw(sheet).rectangle(
        [0, pad * 2 + row, width, pad * 3 + row * 2], fill=(28, 30, 34, 255)
    )
    x = pad
    for s in shown:
        img = layers[s]
        sheet.paste(img, (x, pad + row - s), img)
        sheet.paste(img, (x, pad * 2 + row + row - s), img)
        x += s + gap
    sheet.save(OUT / "icon-preview.png")

    print(f"icon.png   {(OUT / 'icon.png').stat().st_size // 1024} KB  512x512")
    print(f"icon.ico   {(OUT / 'icon.ico').stat().st_size // 1024} KB  {sorted(recipes)}")
    print(f"预览拼版   {OUT / 'icon-preview.png'}")


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    build()
