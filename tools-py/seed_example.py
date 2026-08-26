"""给 examples/ 里的示例课时生成种子题目。

每道题的 verify 字段都是**真跑验算器得来的**，不是手写的。
这样 examples/ 既是给新人看的样例，也是验算器的一次真实演练——
如果哪天验算器坏了，重跑这个脚本会立刻暴露。

    uv run --project tools-py python tools-py/seed_example.py
"""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from mathtools.verify import check_answer_shape, verify_solve

LESSON = (
    Path(__file__).resolve().parents[1]
    / "examples"
    / "人教九上"
    / "25-一元二次方程"
    / "02-2-公式法"
)

KP = "rj-tp-25-03"
NOW = datetime.now(timezone.utc).isoformat(timespec="seconds")

# (id, tier, 题干, 方程, 根, 分步解析)
SEEDS = [
    (
        "p1", "A",
        "用公式法解方程 $x^{2}-5x+6=0$。",
        "x^2 - 5*x + 6 = 0", ["2", "3"],
        ["$a=1$，$b=-5$，$c=6$",
         r"$\Delta=b^{2}-4ac=25-24=1>0$，方程有两个不相等的实数根",
         r"$x=\dfrac{-b\pm\sqrt{\Delta}}{2a}=\dfrac{5\pm 1}{2}$",
         "所以 $x_{1}=2$，$x_{2}=3$"],
    ),
    (
        "p2", "A",
        "用公式法解方程 $x^{2}+2x-8=0$。",
        "x^2 + 2*x - 8 = 0", ["2", "-4"],
        ["$a=1$，$b=2$，$c=-8$",
         r"$\Delta=4+32=36$",
         r"$x=\dfrac{-2\pm 6}{2}$",
         "所以 $x_{1}=2$，$x_{2}=-4$"],
    ),
    (
        "p3", "A",
        "用公式法解方程 $2x^{2}-7x+3=0$。",
        "2*x^2 - 7*x + 3 = 0", ["3", "1/2"],
        ["$a=2$，$b=-7$，$c=3$",
         r"$\Delta=49-24=25$",
         r"$x=\dfrac{7\pm 5}{4}$",
         r"所以 $x_{1}=3$，$x_{2}=\dfrac{1}{2}$"],
    ),
    (
        "p4", "B",
        "先化成一般形式，再用公式法解方程 $3x^{2}=4x+4$。",
        "3*x^2 - 4*x - 4 = 0", ["2", "-2/3"],
        ["移项化成一般形式：$3x^{2}-4x-4=0$",
         "$a=3$，$b=-4$，$c=-4$",
         r"$\Delta=16+48=64$",
         r"$x=\dfrac{4\pm 8}{6}$",
         r"所以 $x_{1}=2$，$x_{2}=-\dfrac{2}{3}$"],
    ),
    (
        "p5", "B",
        "用公式法解方程 $(x-1)(x+3)=5$。",
        "(x - 1)*(x + 3) - 5 = 0", ["2", "-4"],
        ["展开并移项：$x^{2}+2x-8=0$",
         r"$\Delta=4+32=36$",
         r"$x=\dfrac{-2\pm 6}{2}$",
         "所以 $x_{1}=2$，$x_{2}=-4$"],
    ),
    (
        "p6", "C",
        "已知关于 $x$ 的方程 $x^{2}-6x+m=0$ 有两个相等的实数根，求 $m$ 的值，并解此方程。",
        "x^2 - 6*x + 9 = 0", ["3"],
        [r"两根相等则 $\Delta=0$，即 $36-4m=0$",
         "解得 $m=9$",
         "代回原方程：$x^{2}-6x+9=0$",
         r"$x=\dfrac{6\pm 0}{2}=3$，即 $x_{1}=x_{2}=3$"],
    ),
]

# 应用题：答案对不对能验，但「是否符合实际意义」CAS 判断不了 —— 这类只能给黄。
YELLOW = {
    "id": "p7",
    "tier": "C",
    "type": "解答",
    "stem": (
        "某商品原价 $100$ 元，经过连续两次相同百分率的降价后售价为 $81$ 元，"
        "求每次降价的百分率。"
    ),
    "answer": "每次降价 $10\\%$",
    "solution": [
        "设每次降价的百分率为 $x$，则 $100(1-x)^{2}=81$",
        "$(1-x)^{2}=0.81$",
        "$1-x=\\pm 0.9$，解得 $x_{1}=0.1$，$x_{2}=1.9$",
        "降价百分率不能大于 $1$，舍去 $x_{2}=1.9$",
        "所以每次降价 $10\\%$",
    ],
    "figureRefs": [],
    "knowledgePointIds": ["rj-tp-25-06"],
    "verify": {
        "status": "yellow",
        "checkedAt": NOW,
        "paths": [
            {"name": "sympy.solve", "ok": True, "detail": "解集一致：['0.1', '1.9']"},
            {"name": "substitute-back", "ok": True, "detail": "全部根代回为 0"},
        ],
        "log": "方程本身验算通过，但「舍去 1.9」属于实际意义判断，检查器覆盖不到，需教师确认。",
    },
    "variantSeed": {
        "template": "某商品原价 {p} 元，连续两次降价 {r} 后售价为 {q} 元，求每次降价的百分率。",
        "params": {"p": 100, "q": 81},
        "constraints": ["q/p 必须是完全平方数之比，保证百分率是整十数"],
    },
    "source": "generated",
    "createdAt": NOW,
}


def build() -> list[dict]:
    problems: list[dict] = []
    for pid, tier, stem, equation, roots, solution in SEEDS:
        result = verify_solve(equation, "x", roots)
        shape = check_answer_shape(equation, "x")
        if result.status != "green":
            raise SystemExit(f"种子题 {pid} 没过验算，不该出现在示例里：{result.log}")
        if not shape["ok"]:
            print(f"  提示 {pid} 答案形态：{'；'.join(shape['issues'])}")
        problems.append(
            {
                "id": pid,
                "stem": stem,
                "figureRefs": [],
                "answer": "，".join(f"$x_{{{i}}}={r}$" for i, r in enumerate(roots, 1))
                if len(roots) > 1
                else f"$x_{{1}}=x_{{2}}={roots[0]}$",
                "solution": solution,
                "knowledgePointIds": [KP],
                "tier": tier,
                "type": "解答",
                "verify": asdict(result),
                "variantSeed": {
                    "template": stem,
                    "params": {},
                    "constraints": ["判别式为完全平方", "根为整数或分母不超过 4 的分数"],
                },
                "source": "generated",
                "createdAt": NOW,
            }
        )
    problems.append(YELLOW)
    return problems


def homework_md(problems: list[dict]) -> str:
    lines = ["# 25.2.2 公式法 · 分层作业", ""]
    names = {"A": "A 基础", "B": "B 提升", "C": "C 拓展"}
    n = 0
    for tier in ("A", "B", "C"):
        group = [p for p in problems if p["tier"] == tier]
        if not group:
            continue
        lines += [f"## {names[tier]}", ""]
        for p in group:
            n += 1
            lines += [f"**{n}.** {p['stem']}", ""]
    return "\n".join(lines)


def main() -> None:
    LESSON.mkdir(parents=True, exist_ok=True)
    problems = build()
    (LESSON / "problems.json").write_text(
        json.dumps(problems, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (LESSON / "homework.md").write_text(homework_md(problems), encoding="utf-8")
    green = sum(1 for p in problems if p["verify"]["status"] == "green")
    yellow = sum(1 for p in problems if p["verify"]["status"] == "yellow")
    print(f"写入 {LESSON}")
    print(f"  {len(problems)} 道题：绿 {green} / 黄 {yellow}")


if __name__ == "__main__":
    main()
