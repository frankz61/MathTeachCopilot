import { useMemo, type ReactElement } from 'react'
import katex from 'katex'

/**
 * 把 `$...$` 里的 LaTeX 渲染成公式，其余按普通文本走。
 *
 * 这是这个界面上最要紧的一件事：老师是靠「看一眼题目像不像话」来判断要不要用的，
 * 题干如果是 `$x^{2}-5x+6=0$` 这样的源码，再好的排版也没意义。
 *
 * 渲染失败不抛错——一道题的公式写坏了，不该让整个列表白屏。
 */

interface Segment {
  type: 'text' | 'math'
  value: string
}

/** 按 $...$ 切分。反斜杠转义的 \$ 视为普通美元符号。 */
function segment(input: string): Segment[] {
  const out: Segment[] = []
  let buffer = ''
  let i = 0
  while (i < input.length) {
    const ch = input[i]!
    if (ch === '\\' && input[i + 1] === '$') {
      buffer += '$'
      i += 2
      continue
    }
    if (ch === '$') {
      const end = findClosing(input, i + 1)
      if (end > 0) {
        if (buffer) out.push({ type: 'text', value: buffer })
        buffer = ''
        out.push({ type: 'math', value: input.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    buffer += ch
    i += 1
  }
  if (buffer) out.push({ type: 'text', value: buffer })
  return out
}

function findClosing(input: string, from: number): number {
  for (let i = from; i < input.length; i++) {
    if (input[i] === '\\') {
      i += 1
      continue
    }
    if (input[i] === '$') return i
  }
  return -1
}

export function Math({ children }: { children: string }): ReactElement {
  const parts = useMemo(() => segment(children ?? ''), [children])

  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'text') return <span key={i}>{part.value}</span>
        let html: string
        try {
          html = katex.renderToString(part.value, {
            throwOnError: false,
            displayMode: false,
            output: 'html',
            strict: false,
          })
        } catch {
          // 公式写坏了就原样显示源码，至少老师看得出哪里不对
          return (
            <code key={i} className="math-broken" title="公式无法渲染">
              ${part.value}$
            </code>
          )
        }
        return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />
      })}
    </>
  )
}
