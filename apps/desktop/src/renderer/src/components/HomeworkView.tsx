import { type ReactElement } from 'react'
import { Math } from './Math.js'

/**
 * homework.md 的预览。
 *
 * **刻意只支持我们自己导出的那几种语法**：标题、加粗、行内公式。
 * 不引 markdown 库——这个 tab 是给老师确认「打印出来长什么样」的，
 * 支持的语法越多，和 pandoc 实际导出结果的偏差反而越大。
 *
 * 真正的排版事实以导出的 docx 为准，这里只是快速预览。
 */
export function HomeworkView({ source }: { source: string }): ReactElement {
  const lines = source.split(/\r?\n/)

  return (
    <div className="homework">
      {lines.map((line, i) => {
        const trimmed = line.trim()
        if (!trimmed) return <div key={i} className="hw-gap" />
        // 生成标记是给打开文件的人看的，不该出现在预览里
        if (trimmed.startsWith('<!--')) return <div key={i} />
        // 斜体的说明行（如「另有 N 道题未通过验算」）
        const note = /^_(.+)_$/.exec(trimmed)
        if (note) {
          return (
            <p key={i} className="hw-note">
              {note[1]}
            </p>
          )
        }
        // 图片：预览里不渲染实际图片（路径是相对课时目录的），标一行占位就好
        const img = /^!\[[^\]]*\]\(([^)]+)\)$/.exec(trimmed)
        if (img) {
          return (
            <p key={i} className="hw-img">
              [插图 {img[1]}]
            </p>
          )
        }

        // 行内混着图片语法的（题干和图在同一行）也要剥掉
        const inlineImg = trimmed.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim()
        if (inlineImg !== trimmed && inlineImg) {
          return (
            <p key={i} className="hw-p">
              <Inline text={inlineImg} />
            </p>
          )
        }

        const h = /^(#{1,3})\s+(.*)$/.exec(trimmed)
        if (h) {
          const level = h[1]!.length
          const text = h[2]!
          return (
            <div key={i} className={`hw-h hw-h${level}`}>
              <Inline text={text} />
            </div>
          )
        }
        return (
          <p key={i} className="hw-p">
            <Inline text={trimmed} />
          </p>
        )
      })}
    </div>
  )
}

/** 处理 **加粗** 与 $公式$，其余按纯文本 */
function Inline({ text }: { text: string }): ReactElement {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((part, i) => {
        const bold = /^\*\*([^*]+)\*\*$/.exec(part)
        if (bold) {
          return (
            <strong key={i}>
              <Math>{bold[1]!}</Math>
            </strong>
          )
        }
        return <Math key={i}>{part}</Math>
      })}
    </>
  )
}
