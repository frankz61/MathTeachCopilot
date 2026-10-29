r"""教学设计（design.json）的写入闸门、渲染和导出。

结构定义见 packages/shared/src/design.ts，两边要一致。

## 为什么要有闸门

教学设计大半是散文，机器验不了「这个情境好不好」。但有几样毛病是查得出的，
而且都是老师不容易一眼看出来、拿到课堂上才露馅的：

- 引用了一道 problems.json 里不存在的题——导出的教案里那一处就是空的；
- 某个环节没有设计意图——那是这份体例里最要紧的一栏，也是模型最爱省掉的；
- 某条教学目标没有任何环节落实——目标写了四条，课上只做了三条。

所以和 save_problems 一样：模型提交内容，本模块校验，过了才写盘。

## 题为什么不写在这里

例题、练习、检测都在 problems.json 里，这里只存 id。写成两份的话，
老师改了一道例题的数字，教案里的还是旧的——而且它没过验算闸门。
"""

from __future__ import annotations

import json
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .export import find_pandoc
from .homework import figure_lines, option_lines

TEXT_KINDS = ("问题", "追问", "情境", "师生活动", "讲解", "过渡语", "评价语", "说明", "设计意图")
PROBLEM_KIND = "题目"
STRING_FIELDS = ("content", "learnerAnalysis", "path", "intro", "boardPlan")
REQUIRED_STRINGS = ("content", "learnerAnalysis", "intro")

_DIGITS = "一二三四五六七八九十"


def stage_label(index: int) -> str:
    return f"环节{_DIGITS[index]}" if index < len(_DIGITS) else f"环节{index + 1}"


def _load_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def _validate_stage(stage: Any, where: str, problem_ids: set[str], objective_ids: set[str]) -> list[str]:
    if not isinstance(stage, dict):
        return [f"{where}不是对象"]
    errs: list[str] = []
    if not isinstance(stage.get("id"), str) or not stage["id"].strip():
        errs.append(f"{where}缺 id")
    if not isinstance(stage.get("title"), str) or not stage["title"].strip():
        errs.append(f"{where}缺 title（如「创设情境，形成概念」，不要带「环节一」，序号由界面生成）")

    refs = stage.get("objectiveIds")
    if not isinstance(refs, list) or not refs:
        errs.append(f"{where}的 objectiveIds 必须是非空数组：这个环节落实哪几条教学目标")
    else:
        for r in refs:
            if r not in objective_ids:
                errs.append(f"{where}的 objectiveIds 里有 {r!r}，但教学目标里没有这个 id")

    blocks = stage.get("blocks")
    if not isinstance(blocks, list) or not blocks:
        errs.append(f"{where}的 blocks 必须是非空数组")
        return errs

    for j, b in enumerate(blocks):
        bw = f"{where}第 {j + 1} 块"
        if not isinstance(b, dict):
            errs.append(f"{bw}不是对象")
            continue
        kind = b.get("kind")
        if kind == PROBLEM_KIND:
            pid = b.get("problemId")
            if not isinstance(pid, str) or not pid:
                errs.append(f"{bw}是题目块，缺 problemId")
            elif pid not in problem_ids:
                errs.append(
                    f"{bw}引用的题 {pid} 在 problems.json 里不存在。"
                    f"先用 save_problems 把这道题存进去（usage 写例题/练习/检测），再引用它的 id"
                )
        elif kind in TEXT_KINDS:
            if not isinstance(b.get("text"), str) or not b["text"].strip():
                errs.append(f"{bw}（{kind}）的 text 是空的")
        else:
            errs.append(
                f"{bw}的 kind {kind!r} 不认识。可用：{'、'.join(TEXT_KINDS)}，"
                f"或 {PROBLEM_KIND}（配 problemId）"
            )

    if not any(isinstance(b, dict) and b.get("kind") == "设计意图" for b in blocks):
        errs.append(f"{where}没有设计意图。每个环节至少一条，说明这个环节为什么这样安排")
    return errs


def validate(design: Any, problem_ids: set[str]) -> list[str]:
    """结构校验。和 store.py 一样，报错要指名道姓，模型才改得动。"""
    if not isinstance(design, dict):
        return ["design 必须是对象"]
    errs: list[str] = []

    for f in STRING_FIELDS:
        if f in design and not isinstance(design[f], str):
            errs.append(f"{f} 必须是字符串")
    for f in REQUIRED_STRINGS:
        if not isinstance(design.get(f), str) or not design[f].strip():
            errs.append(f"缺 {f}，或它是空的")

    objectives = design.get("objectives")
    objective_ids: set[str] = set()
    if not isinstance(objectives, list) or not objectives:
        errs.append("objectives（教学目标）必须是非空数组，每项 {id, text}")
    else:
        for i, o in enumerate(objectives):
            if not isinstance(o, dict) or not isinstance(o.get("id"), str) or not str(o.get("text", "")).strip():
                errs.append(f"第 {i + 1} 条教学目标必须是 {{id, text}}，且 text 非空")
            elif o["id"] in objective_ids:
                errs.append(f"教学目标 id 重复：{o['id']}")
            else:
                objective_ids.add(o["id"])

    for f, name in (("keyPoints", "教学重点"), ("difficulties", "教学难点")):
        v = design.get(f)
        if not isinstance(v, list) or not v or not all(isinstance(x, str) and x.strip() for x in v):
            errs.append(f"{f}（{name}）必须是非空的字符串数组")

    stages = design.get("stages")
    if not isinstance(stages, list) or not stages:
        errs.append("stages（教学环节）必须是非空数组")
        return errs

    seen: set[str] = set()
    for i, s in enumerate(stages):
        errs.extend(_validate_stage(s, f"第 {i + 1} 个环节", problem_ids, objective_ids))
        sid = s.get("id") if isinstance(s, dict) else None
        if isinstance(sid, str):
            if sid in seen:
                errs.append(f"环节 id 重复：{sid}")
            seen.add(sid)

    covered = {r for s in stages if isinstance(s, dict) for r in (s.get("objectiveIds") or [])}
    for oid in sorted(objective_ids - covered):
        errs.append(f"教学目标 {oid} 没有任何环节落实。要么在某个环节的 objectiveIds 里写上它，要么删掉这条目标")
    return errs


def save_design(
    out_path: str, design: dict[str, Any] | None = None, stage: dict[str, Any] | None = None
) -> dict[str, Any]:
    """校验 → 写盘。任一处不过就整体不写，原文件保持不变。

    两种用法：

      design  整份提交（第一次写、或推倒重来）
      stage   只替换 id 相同的那一个环节（老师说「环节三重写」）

    单列 stage 是因为老师改教案几乎都是一段一段改的。整份重交的话，
    模型会顺手把老师没让动的环节也改了——那些往往是他已经认可了的。
    """
    path = Path(out_path)
    problems = _load_json(path.parent / "problems.json", [])
    problem_ids = {str(p.get("id")) for p in problems if isinstance(p, dict)}

    if (design is None) == (stage is None):
        return {"ok": False, "errors": ["design 和 stage 二选一：整份提交给 design，只改一个环节给 stage"]}

    if stage is not None:
        current = _load_json(path, None)
        if not isinstance(current, dict):
            return {"ok": False, "errors": ["还没有教学设计，不能只改一个环节。先用 design 整份提交"]}
        stages = current.get("stages") or []
        sid = stage.get("id") if isinstance(stage, dict) else None
        if not any(isinstance(s, dict) and s.get("id") == sid for s in stages):
            have = "、".join(str(s.get("id")) for s in stages if isinstance(s, dict))
            return {"ok": False, "errors": [f"没有 id 为 {sid!r} 的环节（现有：{have}）。新增环节请整份提交"]}
        design = {**current, "stages": [stage if s.get("id") == sid else s for s in stages]}

    assert design is not None
    errors = validate(design, problem_ids)
    if errors:
        return {"ok": False, "errors": errors, "written": False}

    record = {
        "content": design["content"],
        "learnerAnalysis": design["learnerAnalysis"],
        "objectives": design["objectives"],
        "keyPoints": design["keyPoints"],
        "difficulties": design["difficulties"],
        "path": design.get("path", ""),
        "intro": design["intro"],
        "stages": design["stages"],
        "boardPlan": design.get("boardPlan", ""),
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    refs = [b["problemId"] for s in record["stages"] for b in s["blocks"] if b.get("kind") == PROBLEM_KIND]
    by_id = {str(p.get("id")): p for p in problems if isinstance(p, dict)}
    yellow = [r for r in refs if (by_id.get(r, {}).get("verify") or {}).get("status") != "green"]
    out: dict[str, Any] = {
        "ok": True,
        "path": str(path),
        "stages": len(record["stages"]),
        "problemRefs": len(refs),
    }
    if yellow:
        out["note"] = f"引用的题里有 {len(yellow)} 道不是绿色（{'、'.join(yellow)}），需要老师确认"
    return out


def render_markdown(design: dict[str, Any], problems: list[dict[str, Any]], title: str) -> str:
    """导出用的 Markdown。标签用粗体，和样例书里蓝字栏目名的作用一样：一眼分得出谁在说话。"""
    by_id = {str(p.get("id")): p for p in problems}
    lines = [f"# {title}", ""]

    def section(name: str, body: list[str]) -> None:
        nonlocal lines
        lines += [f"## {name}", "", *body, ""]

    section("教学内容", [design.get("content", "")])
    if design.get("learnerAnalysis"):
        section("学情分析", [design["learnerAnalysis"]])
    section("教学目标", [f"{i}. {o['text']}" for i, o in enumerate(design.get("objectives", []), 1)])
    section(
        "教学重点与难点",
        [f"1. 教学重点：{'；'.join(design.get('keyPoints', []))}", f"2. 教学难点：{'；'.join(design.get('difficulties', []))}"],
    )
    if design.get("path"):
        section("教学路径", [design["path"]])

    lines += ["## 教学过程设计", ""]
    if design.get("intro"):
        lines += [f"**导入语**　{design['intro']}", ""]

    q = 0
    for i, stage in enumerate(design.get("stages", [])):
        lines += [f"### {stage_label(i)}　{stage.get('title', '')}", ""]
        follow = 0
        for b in stage.get("blocks", []):
            kind = b.get("kind")
            if kind == "问题":
                q += 1
                follow = 0
                lines += [f"**问题 {q}**　{b['text']}", ""]
            elif kind == "追问":
                follow += 1
                lines += [f"**追问 {follow}**　{b['text']}", ""]
            elif kind == PROBLEM_KIND:
                p = by_id.get(b.get("problemId", ""))
                if not p:
                    lines += [f"_（引用的题 {b.get('problemId')} 已被删除）_", ""]
                    continue
                lines += [f"**{p.get('usage', '作业')}**　{p.get('stem', '')}", ""]
                lines += option_lines(p)
                lines += figure_lines(p)
                lines += [f"参考答案：{p.get('answer', '')}", ""]
            else:
                lines += [f"**{kind}**　{b.get('text', '')}", ""]

    if design.get("boardPlan"):
        section("板书设计", [design["boardPlan"]])
    return "\n".join(lines)


def export_docx(lesson_dir: str | Path, out_path: str, title: str) -> dict[str, Any]:
    d = Path(lesson_dir)
    design = _load_json(d / "design.json", None)
    if not isinstance(design, dict):
        return {"ok": False, "error": "这个课时还没有教学设计"}
    problems = _load_json(d / "problems.json", [])

    # 红色的题本来就进不了 problems.json；这里再挡一次没验过的，和作业导出同一条线
    refs = [b.get("problemId") for s in design.get("stages", []) for b in s.get("blocks", []) if b.get("kind") == PROBLEM_KIND]
    by_id = {str(p.get("id")): p for p in problems}
    unverified = [r for r in refs if r in by_id and not by_id[r].get("verify")]
    if unverified:
        return {"ok": False, "error": f"引用的题没有验算记录：{'、'.join(unverified)}"}

    pandoc = find_pandoc()
    if not pandoc:
        return {"ok": False, "error": "找不到 pandoc，导不出带可编辑公式的 Word。见 vendor/README.md"}

    md = render_markdown(design, problems, title)
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "design.md"
        src.write_text(md, encoding="utf-8")
        cmd = [pandoc, str(src), "-f", "markdown", "-t", "docx", "-o", str(out), "--resource-path", str(d)]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "pandoc 超时"}
    if proc.returncode != 0:
        return {"ok": False, "error": f"pandoc 失败：{proc.stderr.strip()}"}
    return {"ok": True, "path": str(out), "exported": len(refs)}
