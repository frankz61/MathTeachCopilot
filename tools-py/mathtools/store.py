r"""problems.json 的写入闸门。

## 为什么不让 Agent 用 Write 直接写这个文件

两个理由，第二个是要命的：

1. **手写含 LaTeX 的 JSON 必然出错。** `$\Delta$` 在 JSON 里要写成 `\\Delta`，
   模型十次有几次会漏。实测第一次跑就写出了非法 JSON。

2. **verify 字段不能由模型自己填。** 如果模型只是「把工具返回的结果抄进去」，
   那它同样可以凭空编一个 `{"status": "green"}`——系统提示里写一百遍「不要编造」
   也只是道德约束。产品唯一不能犯的错就这一个，不能只靠道德约束。

所以这里换成：模型提交**题目 + 该怎么验它**（check 字段），
验算由本模块自己跑，verify 字段由本模块自己写。模型碰不到它。

homework.md 之类的散文产物仍然走 Agent 的 Write/Edit，那里 diff 才是有价值的。
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict
from pathlib import Path
from typing import Any

from .verify import (
    VerifyResult,
    verify_choice,
    verify_evaluate,
    verify_identity,
    verify_solve,
)

TIERS = {"A", "B", "C"}
CHECK_KINDS = {"solve", "identity", "evaluate", "manual", "choice"}
TYPES = {"选择", "填空", "解答", "证明", "作图"}
REQUIRED = ("id", "stem", "answer", "solution", "tier", "type", "check")


def _validate(p: dict[str, Any], index: int) -> list[str]:
    """结构校验。报错要指名道姓，模型才改得动。"""
    errs: list[str] = []
    where = f"第 {index + 1} 道题"

    for field in REQUIRED:
        if field not in p:
            errs.append(f"{where}缺字段 {field}")
    if errs:
        return errs

    if not isinstance(p["stem"], str) or not p["stem"].strip():
        errs.append(f"{where}的 stem 必须是非空字符串")
    if not isinstance(p["answer"], str) or not p["answer"].strip():
        errs.append(f"{where}的 answer 必须是非空字符串")
    if not isinstance(p["solution"], list) or not all(isinstance(s, str) for s in p["solution"]):
        errs.append(f"{where}的 solution 必须是字符串数组（分步解析，一步一项），不是一整段字符串")
    elif len(p["solution"]) < 2:
        errs.append(f"{where}的 solution 至少要 2 步，只有一步不算解析")
    if p["tier"] not in TIERS:
        errs.append(f"{where}的 tier 必须是 A/B/C 之一，收到 {p['tier']!r}")
    if p["type"] not in TYPES:
        errs.append(f"{where}的 type 必须是 {'/'.join(sorted(TYPES))} 之一，收到 {p['type']!r}")

    seed = p.get("variantSeed")
    if seed is not None and not isinstance(seed, dict):
        errs.append(f"{where}的 variantSeed 必须是对象 {{template, params, constraints}}，不是字符串")

    check = p["check"]
    if not isinstance(check, dict) or "kind" not in check:
        errs.append(f"{where}的 check 必须是对象且含 kind")
        return errs
    if check["kind"] not in CHECK_KINDS:
        errs.append(f"{where}的 check.kind 必须是 {'/'.join(sorted(CHECK_KINDS))} 之一")

    errs.extend(_validate_choice(p, where))
    return errs


# 选项写进题干的痕迹：'A. '、'A、'、'A．'、'（A）'
_INLINE_OPTIONS = re.compile(r"(?:^|[\s（(])[ABCD]\s*[.、．)）]\s*\S")


def _validate_choice(p: dict[str, Any], where: str) -> list[str]:
    """选择题的结构要求。

    两条硬要求，都是为了让「有且仅有一个正确选项」这件事变得可校验：

    1. 选择题必须用 check.kind="choice"。用 manual 就只能到黄色，而黄色进不了
       发给学生的卷子——实测 8 道选择题 7 道黄，等于这个题型形同废弃。
    2. 选项写进 options 字段，不要重复写进题干。写在题干里的选项是一个字符串，
       没法逐项验、没法单独排版、出变式时也没法只换干扰项。
    """
    errs: list[str] = []
    check = p["check"]
    kind = check.get("kind")
    is_choice_type = p.get("type") == "选择"
    options = p.get("options")

    if is_choice_type and kind != "choice":
        errs.append(
            f"{where}是选择题，check.kind 必须用 \"choice\"（收到 {kind!r}）。"
            f"格式：{{\"kind\": \"choice\", \"correct\": \"B\", \"basis\": {{...}}}}，"
            f"选项放在题目的 options 字段里。basis 用 solve/identity/evaluate 就能验成绿色，"
            f"概念判断题用 {{\"kind\": \"manual\", \"reason\": \"...\"}}。"
        )
    if kind == "choice":
        if not is_choice_type:
            errs.append(f"{where}用了 check.kind=\"choice\"，那 type 就该是 \"选择\"")
        if not isinstance(options, dict) or len(options) < 2:
            errs.append(
                f"{where}是选择题，必须给 options 字段，形如 "
                f"{{\"A\": \"$x=1$\", \"B\": \"$x=2$\", ...}}，至少 2 项"
            )
        elif not all(isinstance(v, str) and v.strip() for v in options.values()):
            errs.append(f"{where}的 options 里有空值")
        if "correct" not in check:
            errs.append(f"{where}的 check 缺 correct（正确选项的键）")
        basis = check.get("basis")
        if not isinstance(basis, dict) or "kind" not in basis:
            errs.append(
                f"{where}的 check 缺 basis——要说明正确答案怎么算出来。"
                f"可用 solve/identity/evaluate（能验成绿色）或 manual（只能到黄色）"
            )
        elif basis["kind"] not in ("solve", "identity", "evaluate", "manual"):
            errs.append(
                f"{where}的 check.basis.kind 必须是 solve/identity/evaluate/manual 之一"
            )

    # 选项别在题干里再写一遍——否则界面和 Word 里会出现两份
    if isinstance(options, dict) and options:
        stem = p.get("stem", "")
        if isinstance(stem, str) and _INLINE_OPTIONS.search(stem):
            errs.append(
                f"{where}的选项已经在 options 字段里了，题干里不要再写一遍"
                f"（题干里出现了 A. / B. 这样的选项行），否则界面和导出的 Word 里会各有两份"
            )
    return errs


def _run_check(p: dict[str, Any]) -> VerifyResult:
    """按 check 规格真跑一次验算。模型只能描述「怎么验」，不能决定「验没验过」。

    收整道题而不只是 check：选择题的选项是**题目内容**（存在 options 字段），
    不该在 check 里再存一份——两份就会不同步，而不同步的那一刻验的就不是这道题了。
    """
    check = p["check"]
    kind = check["kind"]
    if kind == "choice":
        return verify_choice(p.get("options") or {}, check.get("correct", ""), check["basis"])
    if kind == "solve":
        return verify_solve(
            check["equation"], check.get("variable", "x"), check["claimed_roots"]
        )
    if kind == "identity":
        return verify_identity(check["left"], check["right"])
    if kind == "evaluate":
        return verify_evaluate(
            check["expression"], check.get("substitutions", {}), check["claimed"]
        )
    # manual：几何、开放题、实际意义判断——检查器覆盖不到，给黄，只准教师预览
    reason = check.get("reason", "").strip()
    return VerifyResult(
        "yellow",
        __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(
            timespec="seconds"
        ),
        [],
        reason or "标记为人工确认，但没有说明理由",
    )


def _check_figures(p: dict[str, Any], index: int, lesson_dir: Path) -> list[str]:
    """figureRefs 指向的图必须真的存在。

    引用一张不存在的图，导出时 Word 里就是个空洞，而 problems.json 看起来一切正常——
    这种错老师只有在打印出来发给学生之后才会发现。
    """
    errs: list[str] = []
    refs = p.get("figureRefs") or []
    if not isinstance(refs, list):
        return [f"第 {index + 1} 道题的 figureRefs 必须是数组"]
    for ref in refs:
        if not isinstance(ref, str) or not ref.strip():
            errs.append(f"第 {index + 1} 道题的 figureRefs 里有空项")
            continue
        if not (lesson_dir / ref).exists():
            errs.append(
                f"第 {index + 1} 道题引用的图不存在：{ref}"
                f"（先生成它再提交这道题：题干里的图用 render_figure，"
                f"生活场景插图用 render_illustration）"
            )
    # 题干里 ![](xxx) 引用了图，却没写进 figureRefs
    stem = p.get("stem", "")
    if isinstance(stem, str):
        for m in re.finditer(r"!\[[^\]]*\]\(([^)]+)\)", stem):
            if m.group(1) not in refs:
                errs.append(
                    f"第 {index + 1} 道题的题干引用了 {m.group(1)}，但它不在 figureRefs 里"
                )
    return errs


def save_problems(
    problems: list[dict[str, Any]], out_path: str, mode: str = "replace"
) -> dict[str, Any]:
    """校验 → 重跑验算 → 写盘。任一步失败就整体不写，返回可操作的错误。

    三种模式：

      replace      整体覆盖（Agent 重出一整卷）
      append       保留已有的，接在后面（出变式、分批提交）
      replace_one  只替换 id 相同的那一道（**老师改题**）

    replace_one 单列是必要的：老师改一道题不该动其余的；而且改出问题时
    （比如把答案改错了）要原样保留旧题，不能既没改成又把原题弄丢了。

    没有 append 的话有两个后果，都很实：一是「出变式」只能整卷重交，
    二是题一多，一次性提交的工具参数会被截断（实测 3 道题就触发了，
    模型只好重试，一轮跑了近十分钟）。分批提交是刚需。
    """
    if not isinstance(problems, list) or not problems:
        return {"ok": False, "errors": ["problems 必须是非空数组"]}

    if mode not in ("replace", "append", "replace_one"):
        return {
            "ok": False,
            "errors": [f"mode 只能是 replace / append / replace_one，收到 {mode!r}"],
        }
    if mode == "replace_one" and len(problems) != 1:
        return {"ok": False, "errors": ["replace_one 一次只能提交一道题"]}

    lesson_dir = Path(out_path).parent

    existing: list[dict[str, Any]] = []
    if mode in ("append", "replace_one"):
        try:
            loaded = json.loads(Path(out_path).read_text(encoding="utf-8"))
            existing = loaded if isinstance(loaded, list) else []
        except Exception:
            existing = []  # 文件不存在或坏了，当成从空开始

    errors: list[str] = []
    for i, p in enumerate(problems):
        if not isinstance(p, dict):
            errors.append(f"第 {i + 1} 项不是对象")
        else:
            errors.extend(_validate(p, i))
            errors.extend(_check_figures(p, i, lesson_dir))

    ids = [p.get("id") for p in problems if isinstance(p, dict)]
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        errors.append(f"id 重复：{', '.join(sorted(str(d) for d in dupes))}")

    if mode == "append":
        clash = {p.get("id") for p in problems if isinstance(p, dict)} & {
            p.get("id") for p in existing
        }
        if clash:
            errors.append(
                f"这些 id 在文件里已经有了：{'、'.join(sorted(str(c) for c in clash))}。"
                "追加时换个新 id；确实要改旧题就用 mode=\"replace\" 整体重交。"
            )

    if errors:
        return {"ok": False, "errors": errors, "written": 0}

    out: list[dict[str, Any]] = []
    rejected: list[dict[str, str]] = []
    for p in problems:
        try:
            result = _run_check(p)
        except KeyError as e:
            return {
                "ok": False,
                "errors": [f"题目 {p['id']} 的 check 缺字段 {e}"],
                "written": 0,
            }

        if result.status == "red":
            # 红的一律不写盘。这是产品红线，不给绕过的口子。
            # replace_one 时尤其重要：老师把答案改错了，旧题必须原样留着，
            # 不能既没改成又把原题弄丢。
            rejected.append({"id": str(p["id"]), "reason": result.log})
            continue

        # **保留 check**：老师改完题需要重新验算，而验算规格丢了就没法重跑。
        # 它也是「出变式」的依据——同结构换数字，check 的形状是现成的模板。
        record = dict(p)
        record["figureRefs"] = p.get("figureRefs", [])
        record["knowledgePointIds"] = p.get("knowledgePointIds", [])
        record["variantSeed"] = p.get("variantSeed")
        record["source"] = p.get("source", "generated")
        record["createdAt"] = p.get("createdAt") or result.checkedAt
        record["verify"] = asdict(result)  # 由本模块写，不采信模型提交的内容
        out.append(record)

    if not out:
        return {
            "ok": False,
            "errors": ["所有题目都没通过验算，一道也没写入"],
            "rejected": rejected,
            "written": 0,
        }

    if mode == "append":
        # 已有的接在前面，保持老师看到的顺序稳定
        final = existing + out
    elif mode == "replace_one":
        # 原地替换，不改变这道题在卷子里的位置
        edited = out[0]
        final = [edited if p.get("id") == edited.get("id") else p for p in existing]
        if not any(p.get("id") == edited.get("id") for p in existing):
            final.append(edited)
    else:
        final = out

    path = Path(out_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(final, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    green = sum(1 for p in out if p["verify"]["status"] == "green")
    yellow = len(out) - green
    return {
        "ok": True,
        "path": str(path),
        "written": len(out),
        "total": len(final),
        "green": green,
        "yellow": yellow,
        "rejected": rejected,
    }
