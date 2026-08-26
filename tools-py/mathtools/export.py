"""导出 Word。

两件事在这里是硬约束，都不能靠模型自觉：

1. **公式必须是 OMML**，不能是图片。教研组一定要改，改不了产品就没意义。
   pandoc 的 docx writer 会把 $...$ 里的 LaTeX 转成 Word 原生公式对象。
2. **红色和未验证的题禁止导出**。闸门放在工具层，Agent 绕不过去。
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .homework import figure_lines, option_lines

# 随包分发的 pandoc 优先，其次找 PATH。见 vendor/README.md
_VENDOR_PANDOC = Path(__file__).resolve().parents[2] / "vendor" / "pandoc" / "pandoc.exe"


def find_pandoc() -> str | None:
    if _VENDOR_PANDOC.exists():
        return str(_VENDOR_PANDOC)
    env = os.environ.get("MTC_PANDOC")
    if env and Path(env).exists():
        return env
    return shutil.which("pandoc")


def gate(problems: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """导出闸门。和 packages/shared 里的 exportableProblems 是同一套规则，
    但这一份才是有强制力的——Agent 只能通过这个函数导出。
    """
    ok: list[dict[str, Any]] = []
    blocked: list[dict[str, str]] = []
    for p in problems:
        verify = p.get("verify")
        pid = str(p.get("id", "<无 id>"))
        if not verify:
            blocked.append({"id": pid, "reason": "未验证"})
        elif verify.get("status") == "red":
            blocked.append({"id": pid, "reason": f"验算失败：{verify.get('log', '')}"})
        else:
            ok.append(p)
    return ok, blocked


def render_markdown(problems: list[dict[str, Any]], title: str, with_answers: bool) -> str:
    """按分层分组渲染。数学保持 $...$ 原样交给 pandoc。

    题面部分和 homework.py 用同一套编号与分组规则——两处口径不一致的话，
    老师屏幕上看到的第 3 题和打印出来的第 3 题会对不上。
    """
    lines = [f"# {title}", ""]
    tier_names = {"A": "A 基础", "B": "B 提升", "C": "C 拓展"}
    n = 0
    for tier in ("A", "B", "C"):
        group = [p for p in problems if p.get("tier") == tier]
        if not group:
            continue
        lines += [f"## {tier_names[tier]}", ""]
        for p in group:
            n += 1
            lines += [f"**{n}.** {p.get('stem', '')}", ""]
            lines += option_lines(p)
            lines += figure_lines(p)

    if with_answers:
        lines += ["", r"\newpage", "", "# 参考答案与解析", ""]
        n = 0
        for tier in ("A", "B", "C"):
            for p in [q for q in problems if q.get("tier") == tier]:
                n += 1
                lines += [f"**{n}.** 答案：{p.get('answer', '')}", ""]
                for i, step in enumerate(p.get("solution") or [], 1):
                    lines.append(f"({i}) {step}")
                lines.append("")
    return "\n".join(lines)


def export_docx(
    problems: list[dict[str, Any]],
    out_path: str,
    title: str = "分层作业",
    with_answers: bool = True,
    resource_dir: str | None = None,
) -> dict[str, Any]:
    allowed, blocked = gate(problems)
    if not allowed:
        return {
            "ok": False,
            "error": "没有可导出的题目——全部未验证或验算失败",
            "blocked": blocked,
        }

    pandoc = find_pandoc()
    if not pandoc:
        return {
            "ok": False,
            "error": (
                "找不到 pandoc。它负责把 LaTeX 公式转成 Word 可编辑的 OMML，"
                "没有它导出就没有意义。安装方式见 vendor/README.md"
            ),
            "blocked": blocked,
        }

    md = render_markdown(allowed, title, with_answers)
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "homework.md"
        src.write_text(md, encoding="utf-8")
        cmd = [pandoc, str(src), "-f", "markdown", "-t", "docx", "-o", str(out)]
        if resource_dir:
            cmd += ["--resource-path", resource_dir]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "pandoc 超时", "blocked": blocked}

    if proc.returncode != 0:
        return {"ok": False, "error": f"pandoc 失败：{proc.stderr.strip()}", "blocked": blocked}

    return {
        "ok": True,
        "path": str(out),
        "exported": len(allowed),
        "blocked": blocked,
        "note": "请在 Word 里打开确认公式可编辑（点一下公式应能进入编辑状态，而不是一张图片）",
    }
