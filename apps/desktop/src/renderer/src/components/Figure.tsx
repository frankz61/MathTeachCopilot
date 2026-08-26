import { useEffect, useState, type ReactElement } from 'react'
import { api } from '../devFixture.js'
import { Lightbox } from './Lightbox.js'

/**
 * 题目插图。
 *
 * 走 data URI 而不是 file:// —— 渲染层的 CSP 是 default-src 'self'，
 * file:// 会被静默拦掉，表现是图裂了但控制台什么都不说。
 *
 * 图读不到时**必须显式报出来**：一道题引用了不存在的图，导出到 Word 里
 * 就是个空洞，老师往往要到打印发给学生之后才发现。宁可在这里刺眼一点。
 */
export function Figure({ lessonId, refPath }: { lessonId: string; refPath: string }): ReactElement {
  const [src, setSrc] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'missing'>('loading')
  const [zoom, setZoom] = useState(false)

  useEffect(() => {
    let alive = true
    setState('loading')
    void api()
      .readFigure(lessonId, refPath)
      .then((data) => {
        if (!alive) return
        if (data) {
          setSrc(data)
          setState('ok')
        } else {
          setState('missing')
        }
      })
      .catch(() => alive && setState('missing'))
    return () => {
      alive = false
    }
  }, [lessonId, refPath])

  if (state === 'missing') {
    return (
      <div className="figure-missing">
        图片读不到：<code>{refPath}</code>
        <span>—— 这道题导出到 Word 里会缺图</span>
      </div>
    )
  }

  return (
    <>
      <div className="figure">
        {state === 'ok' && src ? (
          <img
            src={src}
            alt={refPath}
            title="点击看大图"
            onClick={() => setZoom(true)}
          />
        ) : (
          <div className="figure-loading" />
        )}
      </div>
      {zoom && src && (
        <Lightbox src={src} caption={refPath} onClose={() => setZoom(false)} />
      )}
    </>
  )
}
