"""情境插图。

这个模块唯一值得测的不是「图好不好看」，是**那条边界守不守得住**：
带几何量/数据的描述必须在发请求之前就被挡掉。挡不住的后果不是报错，
是一张没人校验过的图被当成题目配图印到卷子上。

所以测试不出网：HTTP 那一层整个替换掉，测的是拒绝逻辑、响应解析、落盘校验。
真出网的那次验证记在 docs/architecture.md §4.20。
"""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

import pytest

from mathtools import illustration
from mathtools.illustration import check_prompt, generate

# 一张 1x1 的合法 PNG，用来喂假响应
PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


@pytest.fixture(autouse=True)
def _endpoint_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    """默认当作配好了网关。没配的情况单独有一条测试。"""
    monkeypatch.setenv("MTC_IMAGE_BASE_URL", "https://gateway.example.com")
    monkeypatch.setenv("MTC_IMAGE_KEY", "sk-test")
    monkeypatch.delenv("MTC_IMAGE_MODEL", raising=False)


def fake_post(response: dict[str, Any], sink: list[dict[str, Any]] | None = None):
    """替换掉 _post_json：记下请求、返回预设的响应。"""

    def _post(url: str, key: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
        if sink is not None:
            sink.append({"url": url, "key": key, "payload": payload, "timeout": timeout})
        return {"ok": True, "json": response}

    return _post


def data_uri_response() -> dict[str, Any]:
    """这个网关实测返回的形状：data[0].url 是内联 data URI。"""
    return {"data": [{"url": "data:image/png;base64," + base64.b64encode(PNG_1X1).decode()}]}


class Test边界:
    """带可测量元素的描述一律拒绝，并说清该改用什么。"""

    @pytest.mark.parametrize(
        "prompt,应提到",
        [
            ("画一个直角三角形 ABC，∠C=90°", "geometry"),
            ("△ABC 和 △DEF 全等", "geometry"),
            ("抛物线 y=x^2-2x-3 的图象", "function"),
            ("在数轴上表示 -2 和 3", "number_line"),
            ("各班参赛人数的条形图", "bar"),
            ("圆 O 的半径是 5", "geometry"),
        ],
    )
    def test_几何和数据类描述被拒(self, prompt: str, 应提到: str) -> None:
        reason = check_prompt(prompt)
        assert reason is not None, f"这条应该被挡下来：{prompt}"
        assert 应提到 in reason, f"拒绝理由里得指出该用哪个 kind，实际是：{reason}"
        assert "render_figure" in reason

    @pytest.mark.parametrize(
        "prompt",
        [
            "两名学生在超市货架前挑选商品",
            "一个小朋友往储蓄罐里投硬币",
            "排队接水的队伍，前面的人正在接水",
            "一辆公交车停在站台边，乘客陆续上车",
        ],
    )
    def test_纯生活场景放行(self, prompt: str) -> None:
        assert check_prompt(prompt) is None, f"这条不该被挡：{prompt}"

    def test_空描述被拒(self) -> None:
        assert check_prompt("   ") is not None

    def test_拒绝发生在发请求之前(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """挡下来就不该花钱、不该等 40 秒。"""
        calls: list[dict[str, Any]] = []
        monkeypatch.setattr(illustration, "_post_json", fake_post(data_uri_response(), calls))

        r = generate("等腰三角形 ABC，底边 BC=6", str(tmp_path / "a.png"))
        assert not r["ok"]
        assert calls == [], "被拒绝的描述不应该发出任何请求"


class Test出图:
    def test_data_uri_响应能落盘(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(illustration, "_post_json", fake_post(data_uri_response()))
        out = tmp_path / "assets" / "scene.png"

        r = generate("小明在水果店挑苹果", str(out))
        assert r["ok"], r.get("error")
        assert out.exists()
        assert out.read_bytes().startswith(b"\x89PNG"), "落盘的必须是真 PNG"
        assert r["bytes"] == len(PNG_1X1)

    def test_b64_json_响应也认(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """OpenAI 官方那套的形状。换个上游不该报「解析失败」。"""
        resp = {"data": [{"b64_json": base64.b64encode(PNG_1X1).decode()}]}
        monkeypatch.setattr(illustration, "_post_json", fake_post(resp))

        r = generate("小明在水果店挑苹果", str(tmp_path / "b.png"))
        assert r["ok"], r.get("error")

    def test_自动建目录(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(illustration, "_post_json", fake_post(data_uri_response()))
        out = tmp_path / "深" / "一点" / "c.png"

        assert generate("公园里两个人在放风筝", str(out))["ok"]
        assert out.exists()

    def test_描述里追加画风且不带文字(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """图里的字写对写错都没法判断，所以一个字都不要，标注留在题干里。"""
        calls: list[dict[str, Any]] = []
        monkeypatch.setattr(illustration, "_post_json", fake_post(data_uri_response(), calls))

        generate("菜市场的摊位", str(tmp_path / "d.png"))
        sent = calls[0]["payload"]["prompt"]
        assert "菜市场的摊位" in sent
        assert "不要出现任何文字" in sent

    def test_模型别名可由环境变量换(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        calls: list[dict[str, Any]] = []
        monkeypatch.setenv("MTC_IMAGE_MODEL", "别的/图模型")
        monkeypatch.setattr(illustration, "_post_json", fake_post(data_uri_response(), calls))

        generate("一家人在客厅看电视", str(tmp_path / "e.png"))
        assert calls[0]["payload"]["model"] == "别的/图模型"

    def test_端点按约定拼在_baseUrl_后面(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """地址不带 /v1，和 ANTHROPIC_BASE_URL 一个规矩。"""
        calls: list[dict[str, Any]] = []
        monkeypatch.setenv("MTC_IMAGE_BASE_URL", "https://gateway.example.com/")
        monkeypatch.setattr(illustration, "_post_json", fake_post(data_uri_response(), calls))

        generate("小区门口的快递柜", str(tmp_path / "f.png"))
        assert calls[0]["url"] == "https://gateway.example.com/v1/images/generations"


class Test挡住坏结果:
    def test_不是_PNG_就不写盘(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """写进去一个错误串、题干却照样引用它，表现是图裂和 Word 里的空洞。"""
        junk = base64.b64encode(b'{"error":"quota"}').decode()
        monkeypatch.setattr(
            illustration, "_post_json", fake_post({"data": [{"b64_json": junk}]})
        )
        out = tmp_path / "g.png"

        r = generate("学校门口的早餐摊", str(out))
        assert not r["ok"]
        assert not out.exists(), "拿到的不是图就不该留下半个文件"

    def test_响应里没有图片数据时报清楚(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            illustration,
            "_post_json",
            fake_post({"error": {"message": "You have exhausted your capacity"}}),
        )
        r = generate("操场上的跳绳比赛", str(tmp_path / "h.png"))
        assert not r["ok"]
        assert "exhausted" in r["error"]

    def test_要求_png_后缀(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """生图模型出的是位图。要 SVG 只有 render_figure 有。"""
        monkeypatch.setattr(illustration, "_post_json", fake_post(data_uri_response()))
        r = generate("一群人在广场上跳舞", str(tmp_path / "i.svg"))
        assert not r["ok"]
        assert "png" in r["error"].lower()
        assert "render_figure" in r["error"]

    def test_尺寸不在支持列表里就本地拒(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        calls: list[dict[str, Any]] = []
        monkeypatch.setattr(illustration, "_post_json", fake_post(data_uri_response(), calls))
        r = generate("下雨天的公交站", str(tmp_path / "j.png"), size="512x512")
        assert not r["ok"]
        assert calls == [], "参数就不对，没必要发出去等 40 秒"

    def test_没配凭据时说清楚去哪儿配(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """打包后老师没填设置就是这个状态，报错必须指得到设置界面。"""
        for k in ("MTC_IMAGE_KEY", "ANTHROPIC_API_KEY"):
            monkeypatch.delenv(k, raising=False)
        r = generate("放学路上的十字路口", str(tmp_path / "k.png"))
        assert not r["ok"]
        assert "设置" in r["error"] and "API Key" in r["error"]


class Test错误翻译:
    """老师看到的必须是能照着做的话，不是一串英文。"""

    @pytest.mark.parametrize(
        "status,关键词",
        [
            (401, "密钥"),
            (429, "限流"),
            (400, "模型名"),
            (500, "网关"),
        ],
    )
    def test_状态码翻成人话(self, status: int, 关键词: str) -> None:
        assert 关键词 in illustration._explain(status, json.dumps({"message": "x"}))
