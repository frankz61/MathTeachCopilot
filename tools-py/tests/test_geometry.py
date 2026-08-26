r"""几何作图的测试。

红线（docs/grok.md 第五节）：**图与题干条件必须同源生成**。
所以重点不是「图好不好看」，而是**图和题干对不上时必须拒绝出图**——
题干写 ∠C=90° 画成钝角，学生照着量只会越量越错。
"""

from __future__ import annotations

import json
from pathlib import Path

from mathtools.geometry import check_assertions, render
from mathtools.store import save_problems

# 3-4-5 直角三角形，直角在 C
RIGHT_TRIANGLE = {"A": [0, 3], "B": [4, 0], "C": [0, 0]}
TRIANGLE_SEGS = [["A", "B"], ["B", "C"], ["C", "A"]]


class Test条件校验:
    def test_一致时通过(self) -> None:
        pts = {k: (float(v[0]), float(v[1])) for k, v in RIGHT_TRIANGLE.items()}
        errs = check_assertions(
            pts,
            [
                {"type": "angle", "at": "C", "rays": ["A", "B"], "equals": 90},
                {"type": "length", "of": ["A", "C"], "equals": 3},
                {"type": "length", "of": ["B", "C"], "equals": 4},
                {"type": "length", "of": ["A", "B"], "equals": 5},
            ],
        )
        assert errs == []

    def test_角度对不上被抓出来(self) -> None:
        pts = {"A": (0.0, 3.0), "B": (4.0, 0.0), "C": (-1.0, -1.0)}
        errs = check_assertions(pts, [{"type": "angle", "at": "C", "rays": ["A", "B"], "equals": 90}])
        assert len(errs) == 1 and "90" in errs[0]

    def test_边长对不上被抓出来(self) -> None:
        pts = {k: (float(v[0]), float(v[1])) for k, v in RIGHT_TRIANGLE.items()}
        errs = check_assertions(pts, [{"type": "length", "of": ["A", "C"], "equals": 5}])
        assert len(errs) == 1 and "AC" in errs[0]

    def test_平行(self) -> None:
        pts = {"A": (0.0, 0.0), "B": (4.0, 0.0), "C": (1.0, 2.0), "D": (5.0, 2.0)}
        assert check_assertions(pts, [{"type": "parallel", "of": [["A", "B"], ["C", "D"]]}]) == []
        pts["D"] = (5.0, 3.0)
        assert len(check_assertions(pts, [{"type": "parallel", "of": [["A", "B"], ["C", "D"]]}])) == 1

    def test_等长(self) -> None:
        pts = {"A": (0.0, 0.0), "B": (3.0, 0.0), "C": (0.0, 0.0), "D": (0.0, 3.0)}
        assert (
            check_assertions(pts, [{"type": "equal_length", "of": [["A", "B"], ["C", "D"]]}]) == []
        )

    def test_共线(self) -> None:
        pts = {"A": (0.0, 0.0), "B": (1.0, 1.0), "C": (2.0, 2.0)}
        assert check_assertions(pts, [{"type": "collinear", "of": ["A", "B", "C"]}]) == []
        pts["C"] = (2.0, 3.0)
        assert len(check_assertions(pts, [{"type": "collinear", "of": ["A", "B", "C"]}])) == 1

    def test_引用了不存在的点(self) -> None:
        pts = {"A": (0.0, 0.0)}
        errs = check_assertions(pts, [{"type": "length", "of": ["A", "Z"], "equals": 1}])
        assert any("Z" in e for e in errs)


class Test出图:
    def test_条件一致时出图(self, tmp_path: Path) -> None:
        out = tmp_path / "assets" / "tri.svg"
        r = render(
            RIGHT_TRIANGLE,
            segments=TRIANGLE_SEGS,
            right_angles=[{"at": "C", "rays": ["A", "B"]}],
            labels=[{"on": ["A", "C"], "text": "3"}],
            asserts=[{"type": "angle", "at": "C", "rays": ["A", "B"], "equals": 90}],
            out_path=str(out),
        )
        assert r["ok"], r.get("error")
        assert out.exists()
        assert "<svg" in out.read_text(encoding="utf-8")
        assert r["checked"] == 1

    def test_条件对不上时拒绝出图(self, tmp_path: Path) -> None:
        out = tmp_path / "bad.svg"
        r = render(
            {"A": [0, 3], "B": [4, 0], "C": [-1, -1]},
            segments=TRIANGLE_SEGS,
            asserts=[{"type": "angle", "at": "C", "rays": ["A", "B"], "equals": 90}],
            out_path=str(out),
        )
        assert not r["ok"]
        assert r["violations"]
        assert not out.exists(), "对不上条件却还是把图画出来了——这是产品红线"

    def test_没给asserts也能画但没有校验(self, tmp_path: Path) -> None:
        # 允许无 asserts（比如纯示意图），但要如实报告 checked=0
        out = tmp_path / "plain.svg"
        r = render(RIGHT_TRIANGLE, segments=TRIANGLE_SEGS, out_path=str(out))
        assert r["ok"] and r["checked"] == 0

    def test_圆(self, tmp_path: Path) -> None:
        out = tmp_path / "circle.svg"
        r = render(
            {"O": [0, 0], "P": [2, 0]},
            circles=[{"center": "O", "through": "P"}],
            asserts=[{"type": "length", "of": ["O", "P"], "equals": 2}],
            out_path=str(out),
        )
        assert r["ok"] and out.exists()

    def test_线段引用不存在的点(self, tmp_path: Path) -> None:
        r = render(
            {"A": [0, 0]}, segments=[["A", "Z"]], out_path=str(tmp_path / "x.svg")
        )
        assert not r["ok"] and "Z" in r["error"]


class Test题目引用的图必须存在:
    def _problem(self, refs: list[str], stem: str = "如图，求 $x$。") -> dict:
        return {
            "id": "g1",
            "stem": stem,
            "answer": "$x=5$",
            "solution": ["由勾股定理", "$x=5$"],
            "tier": "A",
            "type": "解答",
            "figureRefs": refs,
            "check": {"kind": "manual", "reason": "几何题，CAS 覆盖不到"},
        }

    def test_图不存在时拒收(self, tmp_path: Path) -> None:
        r = save_problems([self._problem(["assets/nope.svg"])], str(tmp_path / "problems.json"))
        assert not r["ok"]
        assert any("不存在" in e and "nope.svg" in e for e in r["errors"])

    def test_图存在时通过(self, tmp_path: Path) -> None:
        (tmp_path / "assets").mkdir()
        (tmp_path / "assets" / "tri.svg").write_text("<svg/>", encoding="utf-8")
        r = save_problems([self._problem(["assets/tri.svg"])], str(tmp_path / "problems.json"))
        assert r["ok"], r.get("errors")

    def test_题干引用了图却没写进figureRefs(self, tmp_path: Path) -> None:
        (tmp_path / "assets").mkdir()
        (tmp_path / "assets" / "tri.svg").write_text("<svg/>", encoding="utf-8")
        r = save_problems(
            [self._problem([], stem="如图 ![](assets/tri.svg)，求 $x$。")],
            str(tmp_path / "problems.json"),
        )
        assert not r["ok"]
        assert any("figureRefs" in e for e in r["errors"])

    def test_没有图的题不受影响(self, tmp_path: Path) -> None:
        r = save_problems([self._problem([])], str(tmp_path / "problems.json"))
        assert r["ok"], r.get("errors")
        written = json.loads((tmp_path / "problems.json").read_text(encoding="utf-8"))
        assert written[0]["figureRefs"] == []


class Test统计图:
    """老师让出「统计图表」的题时，Agent 之前只能拿 geometry 硬凑，
    结果条形图上全是 B2、B3 这样的点名，学生读不了。这一组守住新的统计图工具。
    """

    def test_条形图(self, tmp_path: Path) -> None:
        from mathtools.charts import bar

        out = tmp_path / "bar.svg"
        r = bar(["篮球", "足球", "乒乓球", "排球"], [12, 8, 16, 4], str(out), y_label="人数")
        assert r["ok"] and out.exists() and r["total"] == 40
        svg = out.read_text(encoding="utf-8")
        assert "<svg" in svg

    def test_总数对不上时拒绝出图(self, tmp_path: Path) -> None:
        from mathtools.charts import bar

        out = tmp_path / "bad.svg"
        r = bar(["篮球", "足球"], [12, 8], str(out), assert_total=40)
        assert not r["ok"]
        assert "20" in r["error"] and "40" in r["error"]
        assert not out.exists(), "和题干矛盾却还是画了"

    def test_类别与数值数量不符(self, tmp_path: Path) -> None:
        from mathtools.charts import bar

        r = bar(["A", "B", "C"], [1, 2], str(tmp_path / "x.svg"))
        assert not r["ok"] and "对不上" in r["error"]

    def test_负数被拦下(self, tmp_path: Path) -> None:
        from mathtools.charts import bar

        r = bar(["A"], [-1], str(tmp_path / "x.svg"))
        assert not r["ok"] and "不能为负" in r["error"]

    def test_折线图(self, tmp_path: Path) -> None:
        from mathtools.charts import line

        out = tmp_path / "line.svg"
        r = line(["1月", "2月", "3月"], [8, 11, 14], str(out), y_label="用水量/吨")
        assert r["ok"] and out.exists()

    def test_扇形图(self, tmp_path: Path) -> None:
        from mathtools.charts import pie

        out = tmp_path / "pie.svg"
        r = pie(["优", "良", "中"], [18, 14, 8], str(out))
        assert r["ok"] and out.exists()

    def test_扇形图总数为零(self, tmp_path: Path) -> None:
        from mathtools.charts import pie

        r = pie(["A", "B"], [0, 0], str(tmp_path / "x.svg"))
        assert not r["ok"]

    def test_直方图组界必须比频数多一个(self, tmp_path: Path) -> None:
        from mathtools.charts import histogram

        r = histogram([0, 10, 20], [3, 5, 7], str(tmp_path / "x.svg"))
        assert not r["ok"] and "多一个" in r["error"]

    def test_直方图(self, tmp_path: Path) -> None:
        from mathtools.charts import histogram

        out = tmp_path / "hist.svg"
        r = histogram([50, 60, 70, 80, 90], [2, 5, 12, 6], str(out), x_label="成绩")
        assert r["ok"] and out.exists() and r["total"] == 25

    def test_直方图组界必须递增(self, tmp_path: Path) -> None:
        from mathtools.charts import histogram

        r = histogram([0, 20, 10], [1, 2], str(tmp_path / "x.svg"))
        assert not r["ok"] and "递增" in r["error"]
