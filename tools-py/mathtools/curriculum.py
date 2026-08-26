"""教材树查询。

## 为什么必须有这个工具

出题 Skill 的系统提示里有一条硬要求：「不要凭记忆写课标条目号」。
但 Agent 的 cwd 是**课时目录**，里面只有 meta.json 和 problems.json；
知识点数据在仓库的 curriculum/ 下，它够不着。

结果实测出来是：Agent 读到 meta.json 里的 `tp-01-01`，不知道这是什么，
翻了两轮文件没找到，然后放弃收尾——一道题没出，界面上表现为「没反应」。

**给了硬约束就必须给满足它的手段。** 这个模块就是那个手段。
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any


def _curriculum_dir() -> Path | None:
    """由 Electron 主进程通过 MTC_CURRICULUM_DIR 传入；开发期回退到仓库内。"""
    env = os.environ.get("MTC_CURRICULUM_DIR")
    if env and Path(env).is_dir():
        return Path(env)
    fallback = Path(__file__).resolve().parents[2] / "curriculum"
    return fallback if fallback.is_dir() else None


@lru_cache(maxsize=1)
def _load() -> list[dict[str, Any]]:
    d = _curriculum_dir()
    if not d:
        return []
    out: list[dict[str, Any]] = []
    for f in sorted(d.glob("*.json")):
        try:
            out.append(json.loads(f.read_text(encoding="utf-8")))
        except Exception:
            continue  # 单个文件坏了不该让整个工具不可用
    return out


def _walk(nodes: list[dict[str, Any]], chapter: str = "") -> list[tuple[str, dict[str, Any]]]:
    """展平成 (章名, 知识点) 对。教材树深浅不一，统一在这里处理。"""
    out: list[tuple[str, dict[str, Any]]] = []
    for n in nodes:
        title = chapter or n.get("title", "")
        for kp in n.get("knowledgePoints", []) or []:
            out.append((title, kp))
        if n.get("children"):
            out.extend(_walk(n["children"], title))
    return out


def _describe(book: dict[str, Any], chapter: str, kp: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": kp["id"],
        "title": kp["title"],
        "textbook": book.get("textbook", ""),
        "grade": book.get("grade", ""),
        "chapter": chapter,
    }
    if kp.get("desc"):
        out["desc"] = kp["desc"]
    # standard 大多为空——源数据没有课标原文，见 import_curriculum.py 的说明
    if kp.get("standard"):
        out["standard"] = kp["standard"]
    if kp.get("examWeight"):
        out["examWeight"] = kp["examWeight"]
    if kp.get("commonErrors"):
        out["commonErrors"] = kp["commonErrors"]
    if kp.get("prerequisites"):
        out["prerequisites"] = kp["prerequisites"]
    return out


def lookup(ids: list[str] | None = None, query: str = "", limit: int = 12) -> dict[str, Any]:
    books = _load()
    if not books:
        return {
            "ok": False,
            "error": "找不到教材数据。检查 MTC_CURRICULUM_DIR 或仓库的 curriculum/ 目录。",
            "found": [],
        }

    flat: list[tuple[dict[str, Any], str, dict[str, Any]]] = []
    for b in books:
        for chapter, kp in _walk(b.get("nodes", [])):
            flat.append((b, chapter, kp))

    found: list[dict[str, Any]] = []
    missing: list[str] = []

    for kid in ids or []:
        hit = next((t for t in flat if t[2]["id"] == kid), None)
        if hit:
            found.append(_describe(*hit))
        else:
            missing.append(kid)

    if query:
        q = query.strip().lower()
        seen = {f["id"] for f in found}
        for b, chapter, kp in flat:
            if len(found) >= limit:
                break
            if kp["id"] in seen:
                continue
            haystack = f"{kp['title']}{kp.get('desc', '')}{chapter}".lower()
            if q in haystack:
                found.append(_describe(b, chapter, kp))
                seen.add(kp["id"])

    result: dict[str, Any] = {"ok": True, "found": found}
    if missing:
        result["missing"] = missing
        result["hint"] = (
            f"这些 id 在教材数据里不存在：{'、'.join(missing)}。"
            "不要凭记忆编造它们的含义——用 query 参数按关键词搜，或者告诉老师这个知识点没有数据。"
        )
    if not found:
        result["hint"] = "什么都没找到。换个关键词再搜，或直接问老师这节课要考哪个知识点。"
    return result


def resolve_prerequisites(ids: list[str]) -> dict[str, Any]:
    """把前置知识点 id 也翻译成人能读的标题。

    前置关系是跨年级的（如「公式法」依赖八上的「二次根式」），
    所以必须跨全部教材文件查，不能只在当前这一册里找。
    """
    books = _load()
    flat = [(b, c, k) for b in books for c, k in _walk(b.get("nodes", []))]
    out: list[dict[str, Any]] = []
    for kid in ids:
        hit = next((t for t in flat if t[2]["id"] == kid), None)
        out.append(
            _describe(*hit)
            if hit
            else {"id": kid, "title": "(教材数据里没有这个 id)", "textbook": "", "grade": "", "chapter": ""}
        )
    return {"ok": True, "found": out}
