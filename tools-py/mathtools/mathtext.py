r"""题干、教案里「文字 + $公式$」的规范化。

界面用 KaTeX 渲染，宽松；导出走 pandoc，严格。于是同一段文字在软件里好好的，
导出的 Word 里却露出源码——老师在打印之前根本看不出来。实测出现过的几种：

- `$k = $`：pandoc 要求 `$` 内侧紧贴非空白字符，否则不认作公式
- `$2, 4, \\dots$`：模型多转义了一层，`\dots` 成了 `\\dots`。`\\` 在 LaTeX 里是换行，
  公式解析失败，pandoc 就把整段源码原样印出来
- `$1\times 2=2$$2\times 3=6$`：两个公式紧挨，中间的 `$$` 被当成行间公式的分隔符
- `$x$2`：右边的 `$` 紧跟数字，pandoc 不认它是收尾（这是为了「$5 和 $10」这种价钱）
- 填空的 `_`：在 Markdown 里是强调记号，「系数是_，次数是_」整句变斜体

前四种是确定能修的，`normalize` 在存盘时就修掉（save_problems / save_design），
界面和导出一起受益；`$` 不成对修不了，`problems` 里报出来让模型改。
下划线只在生成 Markdown 时转义（`to_markdown`），存盘的内容保持老师写的样子。
"""

from __future__ import annotations

import re

# 多转义时会出现的命令。只修这些，不修任意 `\\` + 字母：
# `\begin{cases}x=1\\y=2\end{cases}` 里的 `\\y` 是正当的换行
_COMMANDS = (
    "times div cdot cdots ldots dots vdots pm mp frac dfrac tfrac sqrt pi "
    "le leq ge geq ne neq approx equiv sim angle triangle perp parallel circ "
    "degree alpha beta gamma theta lambda mu sigma omega Delta infty sum prod "
    "left right text mathrm overline underline overrightarrow vec bar hat "
    "in notin subset cup cap emptyset because therefore quad qquad "
    "Rightarrow Leftrightarrow rightarrow to begin end cases boxed"
).split()
_OVER_ESCAPED = re.compile(r"\\\\(?=(?:" + "|".join(_COMMANDS) + r")(?![A-Za-z]))")

# 图片 ![](assets/a_b.svg) 里的下划线不能转义
_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_BOX_TABLE = re.compile(r"^\s*\+[-—─=+\s]{3,}\+?\s*$", re.M)


def split(text: str) -> list[tuple[bool, str]]:
    r"""按 `$...$` 切成 (是否公式, 内容)。`\$` 是普通美元符号。和界面的 Math.tsx 同一套规则。"""
    out: list[tuple[bool, str]] = []
    buf = ""
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == "\\" and i + 1 < len(text) and text[i + 1] == "$":
            buf += "\\$"
            i += 2
            continue
        if ch == "$":
            j = i + 1
            while j < len(text):
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == "$":
                    break
                j += 1
            if j < len(text):
                if buf:
                    out.append((False, buf))
                    buf = ""
                out.append((True, text[i + 1 : j]))
                i = j + 1
                continue
        buf += ch
        i += 1
    if buf:
        out.append((False, buf))
    return out


def unbalanced(text: str) -> bool:
    """有一个 `$` 落了单。修不了：不知道公式该在哪儿收尾。"""
    return any(not is_math and re.search(r"(?<!\\)\$", s) for is_math, s in split(text))


def normalize(text: str) -> tuple[str, list[str]]:
    """修确定能修的公式写法问题。返回 (修好的文字, 修了什么)。"""
    if "$" not in text:
        return text, []
    fixes: set[str] = set()
    parts = split(text)
    out: list[str] = []
    for k, (is_math, s) in enumerate(parts):
        if not is_math:
            out.append(s)
            continue
        m = s
        fixed = _OVER_ESCAPED.sub(r"\\", m)
        if fixed != m:
            fixes.add("公式里的命令多转义了一层（\\\\times 应为 \\times）")
            m = fixed
        stripped = m.strip()
        if stripped != m:
            fixes.add("公式两端紧贴 $ 处有空格")
            m = stripped
        if not m:
            fixes.add("去掉了空公式 $ $")
            continue
        # 紧挨着上一个公式：中间补一个空格，免得 $$ 成了行间公式
        if out and k > 0 and parts[k - 1][0] and out[-1].endswith("$"):
            out.append(" ")
            fixes.add("两个公式紧挨在一起")
        out.append(f"${m}$")
        nxt = parts[k + 1][1] if k + 1 < len(parts) and not parts[k + 1][0] else ""
        if nxt[:1].isdigit():
            out.append(" ")
            fixes.add("公式右边紧跟数字")
    return "".join(out), sorted(fixes)


def box_table(text: str) -> bool:
    """用 +——+ 手画的表格。导出后会挤成一行乱码，要用 Markdown 竖线表格"""
    return bool(_BOX_TABLE.search(text))


def _escape_text(s: str) -> str:
    """公式外的下划线转义成字面量。图片语法原样保留。"""
    # 已经写成 \_ 的不再转义，否则会多出一个看得见的反斜杠
    esc = lambda t: re.sub(r"(?<!\\)_", r"\\_", t)  # noqa: E731
    out, last = [], 0
    for m in _IMAGE.finditer(s):
        out.append(esc(s[last : m.start()]))
        out.append(m.group(0))
        last = m.end()
    out.append(esc(s[last:]))
    return "".join(out)


def to_markdown(text: str) -> str:
    """一段老师内容 → 交给 pandoc 的 Markdown。

    除了 normalize，还做三件只跟排版有关的事：公式外的 `_` 转义；单个换行变成
    硬换行（老师写的分行要保留，Markdown 默认会把它们并成一段）；竖线表格的行
    原样保留，并在表格前后补空行——表格紧跟在「**板书**」后面时 pandoc 不认。
    """
    fixed, _ = normalize(text or "")
    escaped = "".join(s and (f"${s}$" if is_math else _escape_text(s)) for is_math, s in split(fixed))
    lines = escaped.split("\n")
    out: list[str] = []
    in_table = False
    for i, line in enumerate(lines):
        is_row = line.strip().startswith("|")
        if is_row and not in_table and out and out[-1] != "":
            out.append("")
        if not is_row and in_table and line.strip():
            out.append("")
        in_table = is_row
        nxt_is_text = i + 1 < len(lines) and lines[i + 1].strip() and not lines[i + 1].strip().startswith("|")
        # 行尾反斜杠是 pandoc 的硬换行；空行（段落分隔）和表格行不加
        out.append(line + ("\\" if line.strip() and not is_row and nxt_is_text else ""))
    return "\n".join(out)
