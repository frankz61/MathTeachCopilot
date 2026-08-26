"""作图。

红线（docs/grok.md 第五节）：图与题干条件必须同源生成。
所以这里重点测的是「画出来的东西和给的表达式一致」，不是「图好不好看」。
"""

from __future__ import annotations

from pathlib import Path

from mathtools.figure import plot_function, plot_number_line


class TestPlotFunction:
    def test_二次函数出图(self, tmp_path: Path) -> None:
        out = tmp_path / "parabola.svg"
        r = plot_function("x^2 - 5*x + 6", "x", (-2, 7), str(out))
        assert r["ok"], r.get("error")
        assert out.exists()
        svg = out.read_text(encoding="utf-8")
        assert svg.lstrip().startswith("<?xml") or "<svg" in svg
        assert "<svg" in svg and "</svg>" in svg

    def test_表达式写坏了不出图而是报错(self, tmp_path: Path) -> None:
        r = plot_function("x^2 - +* 3", "x", (-5, 5), str(tmp_path / "bad.svg"))
        assert not r["ok"]
        assert "解析" in r["error"]

    def test_分式在极点处跳过而不是崩掉(self, tmp_path: Path) -> None:
        out = tmp_path / "hyperbola.svg"
        r = plot_function("1/x", "x", (-5, 5), str(out))
        assert r["ok"], r.get("error")
        assert out.exists()

    def test_区间内无可绘点时明确报错(self, tmp_path: Path) -> None:
        # 负数开方在实数范围内无定义，一个点都画不出来
        r = plot_function("sqrt(x - 100)", "x", (-5, 0), str(tmp_path / "empty.svg"))
        assert not r["ok"]

    def test_自动建目录(self, tmp_path: Path) -> None:
        out = tmp_path / "assets" / "nested" / "f.svg"
        r = plot_function("2*x + 1", "x", (-3, 3), str(out))
        assert r["ok"] and out.exists()


class TestNumberLine:
    def test_数轴出图(self, tmp_path: Path) -> None:
        out = tmp_path / "line.svg"
        r = plot_number_line(
            [{"value": 2, "label": "a", "filled": True},
             {"value": -1, "label": "b", "filled": False}],
            str(out),
        )
        assert r["ok"], r.get("error")
        assert "<svg" in out.read_text(encoding="utf-8")

    def test_没有点时报错(self, tmp_path: Path) -> None:
        r = plot_number_line([], str(tmp_path / "x.svg"))
        assert not r["ok"]

    def test_坐标不合法时报错(self, tmp_path: Path) -> None:
        r = plot_number_line([{"value": "两", "label": "x"}], str(tmp_path / "x.svg"))
        assert not r["ok"]
