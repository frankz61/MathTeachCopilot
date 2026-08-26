import { useEffect, type ReactElement } from 'react'

/**
 * 看大图。
 *
 * 老师拍的照片、生成的几何图和统计图，缩略图里常常看不清刻度和标注——
 * 而「看不清」正是他判断这张图能不能用的关键。
 */
export function Lightbox({
  src,
  caption,
  onClose,
}: {
  src: string
  caption?: string
  onClose: () => void
}): ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    // 打开时锁掉背景滚动，否则滚轮会滚下面的题目列表
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true">
      <button className="lightbox-close" title="关闭（Esc）" onClick={onClose}>
        ×
      </button>
      {/* 点图本身不关闭，免得想细看时手一抖就没了 */}
      <img src={src} alt={caption ?? ''} onClick={(e) => e.stopPropagation()} />
      {caption && <div className="lightbox-caption">{caption}</div>}
    </div>
  )
}
