"""出图失败时，工具说的话能不能照着改。

单独一个文件是因为这些测的不是「画得对不对」，是**反馈质量**——
而反馈质量在这个产品里是有产出影响的：实测工作区 81 道题只有 15 道带图，
原因之一就是模型试了一次、收到一句指错方向的提示，然后放弃配图。
"""

from __future__ import annotations

from pathlib import Path

from mathtools.geometry import check_assert_shapes, render

PTS = {"A": [0, 3], "B": [4, 0], "C": [0, 0]}


class Test写法错和条件不成立要分开报:
    def test_键名写错时指出该改成什么(self) -> None:
        # MCP 那层的参数叫 geo_points，条件里却要写 of/at/rays——
        # 这个命名差异真的会让人写成 points/value/kind（本仓库作者第一次就写错了）
        errs = check_assert_shapes([{"kind": "length", "points": ["A", "C"], "value": 3}])
        joined = " ".join(errs)
        assert "kind" in joined and "type" in joined, joined
        assert '"type": "length"' in joined, "得把正确写法贴出来，不能让它猜"

    def test_写法错时不说调坐标(self, tmp_path: Path) -> None:
        """这是那条误导的核心：写法错了却让它去调坐标，调一百次也修不好。"""
        r = render(
            points=PTS,
            asserts=[{"kind": "angle", "at": "C", "rays": ["A", "B"], "value": 90}],
            out_path=str(tmp_path / "g.svg"),
        )
        assert not r["ok"]
        assert "写法" in r["error"]
        assert "坐标不用动" in r["hint"]
        assert "蒙混" not in r["hint"], "写法错不是作弊，别指控它"

    def test_条件不成立时才说调坐标(self, tmp_path: Path) -> None:
        r = render(
            points={"A": [0.6, 3], "B": [4, 0], "C": [0, 0]},
            asserts=[{"type": "angle", "at": "C", "rays": ["A", "B"], "equals": 90}],
            out_path=str(tmp_path / "g.svg"),
        )
        assert not r["ok"]
        assert "调整 points 的坐标" in r["hint"]
        assert "78" in " ".join(r["violations"]), "要说清差多少"

    def test_类型名不存在时列出支持的(self) -> None:
        errs = check_assert_shapes([{"type": "perpendicular", "of": [["A", "B"], ["C", "D"]]}])
        joined = " ".join(errs)
        assert "collinear" in joined and "parallel" in joined

    def test_少了必填键时点名是哪个(self) -> None:
        errs = check_assert_shapes([{"type": "length", "of": ["A", "C"]}])
        assert "equals" in " ".join(errs)

    def test_写法正确就没有意见(self) -> None:
        assert check_assert_shapes(
            [
                {"type": "length", "of": ["A", "C"], "equals": 3},
                {"type": "angle", "at": "C", "rays": ["A", "B"], "equals": 90},
                {"type": "parallel", "of": [["A", "B"], ["C", "B"]]}
            ]
        ) == []


class Test标注被忽略要报出来:
    def test_直角标记形状写错时告知(self, tmp_path: Path) -> None:
        """静默丢弃的后果：图出来了、直角符号没了，谁都不知道为什么。"""
        r = render(
            points=PTS,
            segments=[["A", "B"], ["B", "C"], ["C", "A"]],
            right_angles=[{"vertex": "C", "sides": ["A", "B"]}],  # 键名写错
            out_path=str(tmp_path / "g.svg"),
        )
        assert r["ok"], "图本身是对的，不该整个失败"
        assert "ignored" in r
        assert '"at"' in r["ignored"][0] and '"rays"' in r["ignored"][0]
        assert "ignored" in r["note"], "note 里要提一句，否则容易被忽略"

    def test_边长标注形状写错时告知(self, tmp_path: Path) -> None:
        r = render(
            points=PTS,
            segments=[["A", "C"]],
            labels=[{"edge": ["A", "C"], "label": "3"}],  # 键名写错
            out_path=str(tmp_path / "g.svg"),
        )
        assert r["ok"]
        assert '"on"' in r["ignored"][0] and '"text"' in r["ignored"][0]

    def test_标注引用了不存在的点也要说(self, tmp_path: Path) -> None:
        r = render(
            points=PTS,
            labels=[{"on": ["A", "Z"], "text": "3"}],
            out_path=str(tmp_path / "g.svg"),
        )
        assert r["ok"]
        assert r["ignored"]

    def test_形状都对时没有_ignored(self, tmp_path: Path) -> None:
        r = render(
            points=PTS,
            segments=[["A", "B"], ["B", "C"], ["C", "A"]],
            labels=[{"on": ["A", "C"], "text": "3"}],
            right_angles=[{"at": "C", "rays": ["A", "B"]}],
            asserts=[{"type": "angle", "at": "C", "rays": ["A", "B"], "equals": 90}],
            out_path=str(tmp_path / "g.svg"),
        )
        assert r["ok"], r.get("error")
        assert "ignored" not in r
