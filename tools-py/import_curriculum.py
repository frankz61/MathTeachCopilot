"""把 MathMate 的知识图谱转成本项目的教材树。

    uv run --project tools-py python tools-py/import_curriculum.py [源目录]

源数据（E:/seven_workspace/ai_workspace/MathMate/data）：

  junior_math_kg.json   北师大版 2024 新教材知识图谱
                        3 个领域 / 34 章 / 141 个知识点，带年级、中考权重、内容摘要
                        边：BELONGS_TO(层级) / PREREQUISITE_OF(前置) / RELATED_TO
  teaching_layers.json  51 条常见错因，按知识点 id 挂载

映射到 packages/shared 的 Curriculum：

  chapter → CurriculumNode
  topic   → KnowledgePoint
  misconception(point/cause/fix) → KnowledgePoint.commonErrors

**注意 standard 字段一律留空。** 源数据里的 desc 是内容摘要，不是 2022 版课标
条目原文；出题 Skill 的系统提示明确要求「不要凭记忆写课标条目号」，拿摘要冒充
课标会让模型把它当原文引用。摘要放 desc，standard 等有可靠来源再补。
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

DEFAULT_SOURCE = Path(r"E:/seven_workspace/ai_workspace/MathMate/data")
OUT_DIR = Path(__file__).resolve().parents[1] / "curriculum"

GRADE_NAMES = {
    "七上": "七年级上册",
    "七下": "七年级下册",
    "八上": "八年级上册",
    "八下": "八年级下册",
    "九上": "九年级上册",
    "九下": "九年级下册",
}
GRADE_ORDER = list(GRADE_NAMES)

TEXTBOOK = "北师大版"


def build_common_errors(layers: dict[str, Any]) -> dict[str, list[str]]:
    """把错因压成一句话：错误表现 → 成因 → 纠正。

    分成三个字段的话，模型引用时往往只挑一个；合成一句反而更容易被完整用上。
    """
    out: dict[str, list[str]] = defaultdict(list)
    for mc in layers.get("misconceptions", []):
        topic = mc.get("topic_id")
        if not topic:
            continue
        parts = [mc.get("point", "").strip()]
        if mc.get("cause"):
            parts.append(f"成因：{mc['cause'].strip()}")
        if mc.get("fix"):
            parts.append(f"纠正：{mc['fix'].strip()}")
        out[topic].append("；".join(p for p in parts if p))
    return dict(out)


def build_prerequisites(edges: list[dict[str, Any]]) -> dict[str, list[str]]:
    """PREREQUISITE_OF: from 是 to 的前置 → 反向索引成 to 的前置列表"""
    out: dict[str, list[str]] = defaultdict(list)
    for e in edges:
        if e.get("type") == "PREREQUISITE_OF":
            out[e["to"]].append(e["from"])
    return dict(out)


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SOURCE
    kg_path = src / "junior_math_kg.json"
    if not kg_path.exists():
        raise SystemExit(f"找不到知识图谱：{kg_path}")

    kg = json.loads(kg_path.read_text(encoding="utf-8"))
    layers_path = src / "teaching_layers.json"
    layers = json.loads(layers_path.read_text(encoding="utf-8")) if layers_path.exists() else {}

    errors_by_topic = build_common_errors(layers)
    prereq_by_topic = build_prerequisites(kg.get("edges", []))

    chapters = [n for n in kg["nodes"] if n["level"] == "chapter"]
    topics_by_chapter: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for n in kg["nodes"]:
        if n["level"] == "topic":
            topics_by_chapter[n["parent"]].append(n)

    provenance = kg.get("meta", {}).get("textbook", "")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    used_errors: set[str] = set()
    written: list[tuple[str, int, int, int]] = []

    for grade in GRADE_ORDER:
        grade_chapters = sorted(
            (c for c in chapters if c.get("grade") == grade), key=lambda c: c.get("seq", 0)
        )
        if not grade_chapters:
            continue

        nodes: list[dict[str, Any]] = []
        n_kp = 0
        n_err = 0
        for ch in grade_chapters:
            kps: list[dict[str, Any]] = []
            for tp in sorted(topics_by_chapter.get(ch["id"], []), key=lambda t: t.get("seq", 0)):
                errs = errors_by_topic.get(tp["id"], [])
                if errs:
                    used_errors.add(tp["id"])
                    n_err += len(errs)
                kp: dict[str, Any] = {
                    "id": tp["id"],
                    "title": tp["name"],
                    "standard": "",  # 见模块开头：不拿摘要冒充课标
                    "commonErrors": errs,
                }
                if tp.get("desc"):
                    kp["desc"] = tp["desc"]
                if tp.get("exam_weight"):
                    kp["examWeight"] = tp["exam_weight"]
                if prereq_by_topic.get(tp["id"]):
                    kp["prerequisites"] = sorted(prereq_by_topic[tp["id"]])
                kps.append(kp)
            n_kp += len(kps)

            node: dict[str, Any] = {
                "id": ch["id"],
                "title": f"第{ch['seq']}章 {ch['name']}",
                "knowledgePoints": kps,
            }
            if ch.get("desc"):
                node["desc"] = ch["desc"]
            if ch.get("exam_weight"):
                node["examWeight"] = ch["exam_weight"]
            nodes.append(node)

        doc = {
            "textbook": TEXTBOOK,
            "grade": GRADE_NAMES[grade],
            "source": f"{provenance}（经 MathMate 知识图谱 v{kg.get('meta', {}).get('version', '?')} 导入）",
            "nodes": nodes,
        }
        out = OUT_DIR / f"{TEXTBOOK}{GRADE_NAMES[grade]}.json"
        out.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        written.append((GRADE_NAMES[grade], len(nodes), n_kp, n_err))

    print(f"源：{kg_path}")
    print(f"    {provenance[:60]}")
    print()
    for grade, n_ch, n_kp, n_err in written:
        print(f"  {TEXTBOOK}{grade:8} {n_ch:2} 章 / {n_kp:3} 知识点 / {n_err:2} 条错因")

    total_errors = sum(len(v) for v in errors_by_topic.values())
    orphan = set(errors_by_topic) - used_errors
    print()
    print(f"  合计 {sum(w[2] for w in written)} 个知识点，{sum(w[3] for w in written)}/{total_errors} 条错因已挂载")
    if orphan:
        print(f"  ⚠ {len(orphan)} 条错因的 topic_id 在图谱里找不到：{sorted(orphan)[:5]}")


if __name__ == "__main__":
    main()
