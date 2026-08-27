r"""主进程直调 Python 的命令行入口。

这条路和 MCP server 是两回事：MCP 服务 Agent，cli.py 服务**老师点的按钮**。
导出这类确定性动作不该绕一圈让模型代劳——慢、贵，而且模型可能中途改主意。
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from mathtools.export import find_pandoc

CLI = Path(__file__).resolve().parents[1] / "cli.py"


# 和主进程真正拉起 cli.py 时给的环境一致（apps/desktop/src/main/mcp.ts 的 toolEnv）。
#
# 不给这个环境，子进程的 stdout 走系统区域设置——中文 Windows 上是 GBK，
# 而这边按 utf-8 解，报出来的是 UnicodeDecodeError，指不到任何真问题。
# **每一处拉起 cli.py 都要用它**，否则测的就不是真实调用方式了。
TOOL_ENV = {"PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1", "PATH": ""}


def run_cli(command: str, payload: dict) -> tuple[int, dict]:
    proc = subprocess.run(
        [sys.executable, str(CLI), command],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=TOOL_ENV,
        cwd=str(CLI.parent),
    )
    line = (proc.stdout or "").strip().splitlines()[-1] if proc.stdout.strip() else "{}"
    return proc.returncode, json.loads(line)


def _lesson(tmp_path: Path, problems: list[dict]) -> Path:
    (tmp_path / "problems.json").write_text(
        json.dumps(problems, ensure_ascii=False), encoding="utf-8"
    )
    return tmp_path


GREEN = {
    "id": "p1",
    "stem": r"解方程 $x^{2}-5x+6=0$。",
    "answer": r"$x_{1}=2$，$x_{2}=3$",
    "solution": ["因式分解", "得两根"],
    "tier": "A",
    "type": "解答",
    "figureRefs": [],
    "verify": {"status": "green", "log": "", "paths": []},
}
RED = {**GREEN, "id": "p2", "verify": {"status": "red", "log": "验算失败", "paths": []}}


class Test错误处理:
    def test_未知子命令(self) -> None:
        code, out = run_cli("nope", {})
        assert code == 1 and not out["ok"] and "用法" in out["error"]

    def test_入参不是合法json(self) -> None:
        proc = subprocess.run(
            [sys.executable, str(CLI), "export"],
            input="{不是 json",
            capture_output=True,
            text=True,
            encoding="utf-8",
            env=TOOL_ENV,
            cwd=str(CLI.parent),
        )
        out = json.loads(proc.stdout.strip().splitlines()[-1])
        assert not out["ok"] and "JSON" in out["error"]

    def test_课时不存在(self, tmp_path: Path) -> None:
        code, out = run_cli(
            "export", {"lessonDir": str(tmp_path / "没有"), "outPath": str(tmp_path / "a.docx")}
        )
        assert code == 1 and not out["ok"] and "找不到" in out["error"]

    def test_problems损坏时明确报错(self, tmp_path: Path) -> None:
        (tmp_path / "problems.json").write_text("{坏的", encoding="utf-8")
        code, out = run_cli(
            "export", {"lessonDir": str(tmp_path), "outPath": str(tmp_path / "a.docx")}
        )
        assert not out["ok"] and "解析失败" in out["error"]

    def test_缺参数不会漏出traceback(self, tmp_path: Path) -> None:
        code, out = run_cli("export", {"lessonDir": str(tmp_path)})
        # 主进程只认 JSON，异常必须被包成 JSON 返回
        assert isinstance(out, dict) and not out["ok"]


@pytest.mark.skipif(find_pandoc() is None, reason="没有 pandoc，见 vendor/README.md")
class Test导出:
    def test_正常导出(self, tmp_path: Path) -> None:
        d = _lesson(tmp_path, [GREEN])
        out_file = tmp_path / "out.docx"
        code, out = run_cli(
            "export", {"lessonDir": str(d), "outPath": str(out_file), "withAnswers": True}
        )
        assert code == 0 and out["ok"], out.get("error")
        assert out_file.exists() and out["exported"] == 1

    def test_红色题被闸门拦下(self, tmp_path: Path) -> None:
        d = _lesson(tmp_path, [GREEN, RED])
        out_file = tmp_path / "out.docx"
        _, out = run_cli("export", {"lessonDir": str(d), "outPath": str(out_file)})
        assert out["ok"] and out["exported"] == 1
        assert [b["id"] for b in out["blocked"]] == ["p2"]

    def test_全红时导不出并说明原因(self, tmp_path: Path) -> None:
        d = _lesson(tmp_path, [RED])
        code, out = run_cli("export", {"lessonDir": str(d), "outPath": str(tmp_path / "o.docx")})
        assert code == 1 and not out["ok"]
        assert "没有可导出" in out["error"]

    def test_不含答案时不渲染解析(self, tmp_path: Path) -> None:
        import re
        import zipfile

        d = _lesson(tmp_path, [GREEN])
        out_file = tmp_path / "noans.docx"
        _, out = run_cli(
            "export", {"lessonDir": str(d), "outPath": str(out_file), "withAnswers": False}
        )
        assert out["ok"]
        with zipfile.ZipFile(out_file) as z:
            xml = z.read("word/document.xml").decode("utf-8")
        plain = "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", xml))
        assert "参考答案" not in plain
