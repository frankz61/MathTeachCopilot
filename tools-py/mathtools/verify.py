"""CAS 验算。

核心约定：一道题要过**两条独立路径**才给 green（docs/claude.md 第三节的红线）。
单靠 sympy.solve 一条路径不够——求解器本身也会在边界情况上给出误导性结果，
代回原式是一条真正独立的证据链。
"""

from __future__ import annotations

import random
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Literal

import sympy as sp
from sympy.parsing.sympy_parser import (
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

_TRANSFORMS = standard_transformations + (implicit_multiplication_application,)

VerifyStatus = Literal["green", "yellow", "red"]


@dataclass
class VerifyPath:
    name: str
    ok: bool
    detail: str


@dataclass
class VerifyResult:
    status: VerifyStatus
    checkedAt: str
    paths: list[VerifyPath]
    log: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _parse(text: str) -> sp.Expr:
    """把题面里的表达式转成 sympy。允许 ^ 当乘方，教师习惯这么写。"""
    return parse_expr(text.replace("^", "**"), transformations=_TRANSFORMS, evaluate=True)


def _to_relational(text: str) -> sp.Expr:
    """把 lhs=rhs 转成 lhs-rhs；没有等号就当作已经等于 0。"""
    if "=" in text:
        lhs, rhs = text.split("=", 1)
        return _parse(lhs) - _parse(rhs)
    return _parse(text)


def _result(paths: list[VerifyPath], yellow_reason: str | None = None) -> VerifyResult:
    if yellow_reason is not None:
        return VerifyResult("yellow", _now(), paths, yellow_reason)
    failed = [p for p in paths if not p.ok]
    if failed:
        return VerifyResult(
            "red", _now(), paths, "；".join(f"{p.name}: {p.detail}" for p in failed)
        )
    return VerifyResult("green", _now(), paths, "")


# --------------------------------------------------------------------------
# 解方程
# --------------------------------------------------------------------------


def verify_solve(equation: str, variable: str, claimed_roots: list[str]) -> VerifyResult:
    """路径一：独立求解并比对根集。路径二：把声称的根代回原式。"""
    paths: list[VerifyPath] = []
    try:
        expr = _to_relational(equation)
        var = sp.Symbol(variable)
        claimed = [_parse(r) for r in claimed_roots]
    except Exception as e:  # 解析失败本身就是 red，题面写坏了
        return _result([VerifyPath("parse", False, f"表达式无法解析：{e}")])

    # 路径一：独立求解
    try:
        solved = sp.solve(sp.Eq(expr, 0), var, dict=False)
        solved_set = {sp.nsimplify(sp.simplify(s)) for s in solved}
        claimed_set = {sp.nsimplify(sp.simplify(c)) for c in claimed}
        if solved_set == claimed_set:
            paths.append(
                VerifyPath("sympy.solve", True, f"解集一致：{sorted(map(str, solved_set))}")
            )
        else:
            paths.append(
                VerifyPath(
                    "sympy.solve",
                    False,
                    f"解集不一致，求解得 {sorted(map(str, solved_set))}，"
                    f"声称 {sorted(map(str, claimed_set))}",
                )
            )
    except Exception as e:
        paths.append(VerifyPath("sympy.solve", False, f"求解失败：{e}"))

    # 路径二：代回原式（与求解器完全独立）
    bad: list[str] = []
    for r in claimed:
        try:
            residual = sp.simplify(expr.subs(var, r))
            if residual != 0:
                bad.append(f"{r} 代回得 {residual}，不为 0")
        except Exception as e:
            bad.append(f"{r} 代回失败：{e}")
    paths.append(
        VerifyPath("substitute-back", not bad, "全部根代回为 0" if not bad else "；".join(bad))
    )

    return _result(paths)


# --------------------------------------------------------------------------
# 恒等变形（化简 / 因式分解）
# --------------------------------------------------------------------------


def verify_identity(left: str, right: str) -> VerifyResult:
    """路径一：符号化简差为 0。路径二：随机数值抽样（独立于符号引擎）。"""
    paths: list[VerifyPath] = []
    try:
        a, b = _parse(left), _parse(right)
    except Exception as e:
        return _result([VerifyPath("parse", False, f"表达式无法解析：{e}")])

    diff = a - b
    try:
        ok = sp.simplify(diff) == 0
        detail = "差化简为 0" if ok else f"差化简得 {sp.simplify(diff)}，不为 0"
        paths.append(VerifyPath("simplify", ok, detail))
    except Exception as e:
        paths.append(VerifyPath("simplify", False, f"化简失败：{e}"))

    # 路径二：随机代值。躲开分母为零的点，重试若干次。
    syms = sorted(diff.free_symbols, key=str)
    rng = random.Random(20260819)
    mismatches: list[str] = []
    samples = 0
    for _ in range(60):
        if samples >= 12:
            break
        subs = {s: sp.Rational(rng.randint(-20, 20), rng.randint(1, 7)) for s in syms}
        try:
            val = complex(sp.N(diff.subs(subs)))
        except Exception:
            continue  # 该点无定义，换一个
        if val != val:  # NaN
            continue
        samples += 1
        if abs(val) > 1e-9:
            mismatches.append(f"{subs} 代入得 {val:.6g}")
    if samples == 0:
        paths.append(VerifyPath("numeric-sampling", False, "找不到可代入的点，无法数值复核"))
    else:
        detail = (
            f"{samples} 个采样点全部为 0" if not mismatches else "；".join(mismatches[:3])
        )
        paths.append(VerifyPath("numeric-sampling", not mismatches, detail))

    return _result(paths)


# --------------------------------------------------------------------------
# 求值
# --------------------------------------------------------------------------


def verify_evaluate(
    expression: str, substitutions: dict[str, str], claimed: str
) -> VerifyResult:
    paths: list[VerifyPath] = []
    try:
        expr = _parse(expression)
        subs = {sp.Symbol(k): _parse(v) for k, v in substitutions.items()}
        want = _parse(claimed)
    except Exception as e:
        return _result([VerifyPath("parse", False, f"表达式无法解析：{e}")])

    try:
        got = sp.simplify(expr.subs(subs))
        ok = sp.simplify(got - want) == 0
        paths.append(VerifyPath("symbolic-eval", ok, f"代入得 {got}，声称 {want}"))
    except Exception as e:
        paths.append(VerifyPath("symbolic-eval", False, f"求值失败：{e}"))

    try:
        got_n = complex(sp.N(expr.subs(subs)))
        want_n = complex(sp.N(want))
        ok = abs(got_n - want_n) < 1e-9
        paths.append(VerifyPath("numeric-eval", ok, f"数值 {got_n:.6g} 对 {want_n:.6g}"))
    except Exception as e:
        paths.append(VerifyPath("numeric-eval", False, f"数值求值失败：{e}"))

    return _result(paths)


# --------------------------------------------------------------------------
# 选择题
# --------------------------------------------------------------------------

# 选项里常见的分隔：'x_1=1，x_2=3'、'2 或 3'、'2、3'
_OPT_SPLIT = re.compile(r"[,，;；、]|\s+或\s+|\s+和\s+")
# 'x='、'x_1='、'x₁='、'y ='——选项里习惯带变量名，验算时要剥掉
_VAR_PREFIX = re.compile(r"^[A-Za-z]\s*(?:_\{?\d+\}?|[₁₂₃₄])?\s*=")


def _delatex(text: str) -> str:
    """把初中题面常见的 LaTeX 降级成 sympy 能读的写法。

    只处理常见的几种，处理不了的原样返回——让 parse 明确失败，
    比悄悄猜错要好得多：猜错会把一道错题判成绿的。
    """
    # 全部 $ 一起去掉，不能只剥首尾：'$x=2$ 或 $x=3$' 这种一个选项里有两段行内公式，
    # 只剥首尾会留下中间的 $，整个选项就解析不出来了（于是干扰项检查静默失效）
    t = text.replace("$", " ").strip()
    t = re.sub(r"\\left|\\right|\\,|\\;|\\!|\\quad|\\qquad", " ", t)
    t = re.sub(r"\\d?frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}", r"((\1)/(\2))", t)
    t = re.sub(r"\\sqrt\s*\{([^{}]+)\}", r"sqrt(\1)", t)
    t = re.sub(r"\\sqrt\s*(\d+)", r"sqrt(\1)", t)
    t = t.replace("\\times", "*").replace("\\cdot", "*").replace("\\div", "/")
    t = t.replace("\\pi", "pi").replace("\\%", "/100").replace("%", "/100")
    t = re.sub(r"\s+", " ", t)
    return t.strip()


def _roots_of(text: str) -> list[str]:
    """选项文本 → 根的列表。'x_1=1，x_2=3' → ['1', '3']"""
    out: list[str] = []
    for part in _OPT_SPLIT.split(_delatex(text)):
        part = _VAR_PREFIX.sub("", part.strip()).strip()
        if part:
            out.append(part)
    return out


#: basis 里的占位符。写了它就表示「选项本身是待判的式子」，而不是候选答案。
OPTION_SLOT = "{option}"


def _has_slot(basis: dict[str, Any]) -> bool:
    return any(
        OPTION_SLOT in v
        for v in basis.values()
        if isinstance(v, str)
    ) or any(
        isinstance(v, list) and any(OPTION_SLOT in x for x in v if isinstance(x, str))
        for v in basis.values()
    )


def _fill_slot(basis: dict[str, Any], text: str) -> dict[str, Any]:
    """把 basis 里所有 {option} 换成这个选项的内容。

    不加括号包裹：占位符应该独占整个字段（"equation": "{option}"），
    而选项常常自带等号（3x-1=2x+1），套上括号反而解析不了。
    """
    out: dict[str, Any] = {}
    for k, v in basis.items():
        if isinstance(v, str):
            out[k] = v.replace(OPTION_SLOT, text)
        elif isinstance(v, list):
            out[k] = [x.replace(OPTION_SLOT, text) if isinstance(x, str) else x for x in v]
        else:
            out[k] = v
    return out


# 选项里合法的连接词。去掉它们之后还剩中文，就说明这个选项是句子而不是式子。
_CONNECTORS = re.compile(r"[或和及与、，,;；]|\s")
_CJK = re.compile(r"[一-鿿]")


def _is_prose(text: str) -> bool:
    """这个选项是句子（'以上都不对'、'真命题'、'甲比乙快'）而不是式子吗？

    必须显式判掉。sympy 的 parse_expr 会把不认识的标识符**当成符号**接受，
    于是 '以上都不对' 解析"成功"、比对失败、被当成一个已验证过的错误干扰项——
    实际上根本没验。看起来更强的检查，其实是虚报。
    """
    return bool(_CJK.search(_CONNECTORS.sub("", _delatex(text))))


def _option_holds(
    basis: dict[str, Any], text: str
) -> tuple[bool | None, str]:
    """这个选项的内容成立吗？

    返回 (成立?, 说明)。第一项为 None 表示**判不了**（选项解析不出来）——
    这和「不成立」必须分开：一个解析不出的干扰项看起来像是通过了检查，
    实际上根本没验，把它当通过就是在虚报。
    """
    kind = basis["kind"]
    if _is_prose(text):
        return None, "选项是文字表述，不是式子，机器判不了"

    # 「下列方程中，解为 x=2 的是（　　）」——这一族里**选项本身是待判的式子**，
    # 不是候选答案。basis 里写 {option} 占位，逐项代进去跑一遍即可。
    # 没有这个模式，这一整族选择题都只能落到黄色，而它是选择题里最大的一族。
    if _has_slot(basis):
        b = _fill_slot(basis, _delatex(text))
        try:
            if kind == "solve":
                r = verify_solve(b["equation"], b.get("variable", "x"), b["claimed_roots"])
            elif kind == "identity":
                r = verify_identity(b["left"], b["right"])
            elif kind == "evaluate":
                r = verify_evaluate(
                    b["expression"], b.get("substitutions", {}), b["claimed"]
                )
            else:
                return None, f"basis.kind={kind!r} 不支持 {OPTION_SLOT} 占位"
        except Exception as e:
            return None, f"代入 {OPTION_SLOT} 后判定出错：{e}"
        if any(p.name == "parse" and not p.ok for p in r.paths):
            return None, f"选项代入后无法解析：{r.log}"
        return r.status == "green", r.log or "成立"

    try:
        if kind == "solve":
            roots = _roots_of(text)
            if not roots:
                return None, "选项里读不出任何根"
            r = verify_solve(basis["equation"], basis.get("variable", "x"), roots)
        elif kind == "identity":
            r = verify_identity(basis["left"], _delatex(text))
        elif kind == "evaluate":
            r = verify_evaluate(
                basis["expression"], basis.get("substitutions", {}), _delatex(text)
            )
        else:
            return None, f"basis.kind={kind!r} 无法机器判定"
    except Exception as e:
        return None, f"判定时出错：{e}"
    if any(p.name == "parse" and not p.ok for p in r.paths):
        return None, f"选项无法解析：{r.log}"
    return r.status == "green", r.log or "成立"


def verify_choice(
    options: dict[str, str], correct: str, basis: dict[str, Any]
) -> VerifyResult:
    """选择题三条路径。

    第三条是选择题独有的，也是最值得加这一档的理由：**逐个确认干扰项都不成立。**
    「两个选项都对」是选择题最典型的硬伤，而它在题面上完全看不出来——
    老师印了发下去，学生按另一个正确选项答，判错了才发现。

    basis 给代数依据就能绿；给 manual（概念判断、命题真假）只能到黄，
    但选项集合那条路径照样跑——互异性和唯一性不需要 CAS 也能查。
    """
    paths: list[VerifyPath] = []

    # 路径一：选项集合本身是否合法
    problems: list[str] = []
    if len(options) < 2:
        problems.append(f"只有 {len(options)} 个选项，至少要 2 个")
    if correct not in options:
        problems.append(f"correct={correct!r} 不在选项里（选项有 {sorted(options)}）")
    seen: dict[str, str] = {}
    for key in sorted(options):
        norm = _delatex(options[key]).replace(" ", "")
        if norm in seen:
            problems.append(f"选项 {seen[norm]} 和 {key} 内容相同：{options[key]!r}")
        else:
            seen[norm] = key
    paths.append(
        VerifyPath(
            "option-set",
            not problems,
            f"{len(options)} 个选项，两两互异，正确项 {correct}"
            if not problems
            else "；".join(problems),
        )
    )
    if problems:
        return _result(paths)

    # basis 是 manual：正确性判不了，但上面那条已经查过了，如实给黄
    if basis.get("kind") == "manual":
        reason = (basis.get("reason") or "").strip()
        return _result(
            paths,
            yellow_reason=(
                f"选项集合已校验（{len(options)} 个，两两互异）；"
                f"正确性需教师确认：{reason or '未说明理由'}"
            ),
        )

    # 路径二：正确选项确实成立
    #
    # 「判不了」和「验出来是错的」必须分开处理，这是本函数里最容易搞错的一处：
    # 前者是能力边界（'以上都不对' 这类文字选项是合法题型），给黄，老师自己确认；
    # 后者是真矛盾（声称 B 对，实算 B 错），给红，禁止导出。
    # 把前者也判成红，等于把一整类正当的选择题拦死在门外。
    ok, detail = _option_holds(basis, options[correct])
    if ok is None:
        return _result(
            paths,
            yellow_reason=(
                f"正确选项 {correct} 无法机器判定（{detail}）。"
                f"这类题的 basis 应改成 manual 并写明希望老师确认什么。"
            ),
        )
    paths.append(VerifyPath("correct-option", ok, f"选项 {correct}：{detail}"))

    # 路径三：干扰项逐个确认不成立
    also_correct: list[str] = []
    undecided: list[str] = []
    for key in sorted(options):
        if key == correct:
            continue
        held, why = _option_holds(basis, options[key])
        if held is True:
            also_correct.append(f"{key}（{options[key]}）也成立")
        elif held is None:
            undecided.append(f"{key}: {why}")
    if also_correct:
        paths.append(
            VerifyPath("distractors", False, "不止一个正确选项：" + "；".join(also_correct))
        )
    elif undecided:
        # 判不了的干扰项不能算通过，但也不该判成 red——如实说明，落到黄
        paths.append(VerifyPath("distractors", True, f"其余选项均不成立（{len(options) - 1 - len(undecided)} 项已验）"))
        res = _result(paths)
        if res.status == "green":
            return VerifyResult(
                "yellow",
                res.checkedAt,
                paths,
                "有干扰项无法机器判定，需教师确认它们确实是错的：" + "；".join(undecided),
            )
        return res
    else:
        paths.append(
            VerifyPath("distractors", True, f"其余 {len(options) - 1} 个选项均不成立")
        )

    return _result(paths)


# --------------------------------------------------------------------------
# 答案形态：老师判断题目专不专业的第一眼
# --------------------------------------------------------------------------


def check_answer_shape(equation: str, variable: str) -> dict[str, Any]:
    """检查答案好不好看。见 docs/claude.md 第三节「参数控制」。

    不是对错问题，是专业度问题——x = 7/13 这种答案没有教学意义。
    """
    issues: list[str] = []
    facts: dict[str, Any] = {}
    try:
        expr = sp.expand(_to_relational(equation))
        var = sp.Symbol(variable)
    except Exception as e:
        return {"ok": False, "issues": [f"表达式无法解析：{e}"], "facts": {}}

    try:
        poly = sp.Poly(expr, var)
        facts["degree"] = poly.degree()
        if poly.degree() == 2:
            a = poly.coeff_monomial(var**2)
            b = poly.coeff_monomial(var)
            c = poly.coeff_monomial(1)
            disc = sp.simplify(b**2 - 4 * a * c)
            facts["discriminant"] = str(disc)
            if disc.is_number:
                if disc < 0:
                    issues.append("判别式为负，方程在实数范围无解——初中阶段一般不该出现")
                else:
                    root = sp.sqrt(disc)
                    facts["discriminantIsPerfectSquare"] = bool(root.is_Integer)
                    if not root.is_Integer:
                        issues.append(
                            f"判别式 {disc} 不是完全平方，根会带根号，建议反向调整系数"
                        )
    except sp.PolynomialError:
        facts["degree"] = None

    try:
        roots = sp.solve(sp.Eq(expr, 0), var)
        facts["roots"] = [str(r) for r in roots]
        for r in roots:
            if r.is_number and not r.is_real:
                issues.append(f"根 {r} 不是实数")
            elif r.is_Rational and not r.is_Integer:
                if abs(sp.denom(r)) > 4:
                    issues.append(f"根 {r} 的分母偏大，数字不便于心算")
            elif r.is_number and not r.is_Rational:
                issues.append(f"根 {r} 不是有理数，初中作业题一般应避免")
    except Exception as e:
        issues.append(f"求根失败：{e}")

    return {"ok": not issues, "issues": issues, "facts": facts}
