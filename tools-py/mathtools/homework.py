r"""从 problems.json 生成 homework.md。

## 为什么是生成的，不是手写的

原来的做法是让 Agent 用 Write 写 homework.md。问题是它和 problems.json 内容重复：
老师删掉一道题、或者让 Agent 出了几道变式，problems.json 变了而 homework.md 没变——
**他手上那张要发给学生的卷子就是旧的**，而且看不出来。

docs/claude.md 第四节早就写了正解：「单一 source of truth，多种导出，改一处全联动」。
problems.json 是事实，homework.md 是它的一个视图。

## 老师要改的东西放哪

抬头（姓名/班级/日期）、卷首说明这类固定内容，放课时目录下的 preamble.md，
生成时原样插在最前面。**那是模板，不是内容** —— 分开之后，重新生成不会丢它。

正文部分手改会被覆盖，所以文件头写明了这件事。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

MARKER = "<!-- 由 problems.json 自动生成，手改正文会被覆盖。固定抬头请写在 preamble.md -->"

TIER_NAMES = {"A": "A 基础", "B": "B 提升", "C": "C 拓展"}


def option_lines(problem: dict[str, Any]) -> list[str]:
    """输出选择题的选项。

    选项存在 options 字段而不是题干里（见 store.py 的 _validate_choice），
    所以渲染时要单独摆出来——否则卷子上的选择题只有问句、没有选项。

    短选项排一行、用全角空格分隔，这是教材的排法，也让一道选择题只占一行；
    长选项一项一行，挤在一行会读不出边界。全角空格是普通 Unicode 字符，
    pandoc 会原样带进 Word，不像半角空格那样被折叠掉。
    """
    options = problem.get("options")
    if not isinstance(options, dict) or not options:
        return []
    keys = sorted(options)
    parts = [f"{k}. {options[k]}" for k in keys]
    if all(len(options[k]) <= 12 for k in keys):
        return ["　　".join(parts), ""]
    return [p + "  " for p in parts] + [""]


def figure_lines(problem: dict[str, Any]) -> list[str]:
    """输出题目的插图，**跳过题干里已经引用过的**。

    Agent 被要求两处都写（题干里 ![](...) 便于定位，figureRefs 便于校验和 UI 渲染），
    渲染时如果两边都输出，同一张图会印两遍。实测第一次就踩到了。
    """
    stem = problem.get("stem", "") or ""
    out: list[str] = []
    for ref in problem.get("figureRefs") or []:
        if f"]({ref})" in stem:
            continue  # 题干里已经有了
        out += [f"![]({ref})", ""]
    return out

# 红色和未验证的题不进作业纸——和导出闸门同一条规则，
# 免得出现「卷子上有但导不出去」这种自相矛盾
EXPORTABLE = {"green", "yellow"}


def render(problems: list[dict[str, Any]], title: str, preamble: str = "") -> str:
    usable = [
        p for p in problems if (p.get("verify") or {}).get("status") in EXPORTABLE
    ]

    lines = [MARKER, "", f"# {title}", ""]
    if preamble.strip():
        lines += [preamble.strip(), ""]

    if not usable:
        lines += ["_还没有可用的题目。_", ""]
        return "\n".join(lines)

    n = 0
    for tier in ("A", "B", "C"):
        group = [p for p in usable if p.get("tier") == tier]
        if not group:
            continue
        lines += [f"## {TIER_NAMES[tier]}", ""]
        for p in group:
            n += 1
            lines += [f"**{n}.** {p.get('stem', '')}", ""]
            lines += option_lines(p)
            lines += figure_lines(p)

    skipped = len(problems) - len(usable)
    if skipped:
        lines += [
            "",
            f"_另有 {skipped} 道题未通过验算，已从本卷排除。_",
            "",
        ]
    return "\n".join(lines)


def regenerate(lesson_dir: str | Path, title: str | None = None) -> dict[str, Any]:
    """重新生成课时目录下的 homework.md。

    返回 changed 表示内容是否真的变了——调用方（文件监听）靠它避免
    「写文件 → 触发监听 → 又写文件」的死循环。
    """
    d = Path(lesson_dir)
    problems_file = d / "problems.json"
    if not problems_file.exists():
        return {"ok": False, "error": f"找不到 {problems_file}", "changed": False}

    try:
        problems = json.loads(problems_file.read_text(encoding="utf-8"))
    except Exception as e:
        return {"ok": False, "error": f"problems.json 解析失败：{e}", "changed": False}

    if title is None:
        try:
            meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
            title = f"{meta.get('lesson', '分层作业')} · 分层作业"
        except Exception:
            title = "分层作业"

    preamble_file = d / "preamble.md"
    preamble = preamble_file.read_text(encoding="utf-8") if preamble_file.exists() else ""

    content = render(problems, title, preamble)
    out = d / "homework.md"

    old = out.read_text(encoding="utf-8") if out.exists() else None
    if old == content:
        return {"ok": True, "changed": False, "path": str(out)}

    # 老师整个重写过（把生成标记删了）就不动它，避免覆盖他的心血
    if old is not None and MARKER not in old:
        return {
            "ok": True,
            "changed": False,
            "skipped": True,
            "reason": "homework.md 已被手工改写（没有生成标记），不覆盖",
            "path": str(out),
        }

    out.write_text(content, encoding="utf-8")
    return {"ok": True, "changed": True, "path": str(out), "problems": len(problems)}
