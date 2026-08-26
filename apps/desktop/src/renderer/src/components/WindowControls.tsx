import { useEffect, useState, type ReactElement } from 'react'
import { api } from '../devFixture.js'

/**
 * 自绘的窗口控件：最小化 / 最大化-还原 / 关闭。
 *
 * 窗口是无边框的（`frame: false`），系统不再画标题栏，这三个按钮就得自己来。
 *
 * 尺寸照 Windows 的规矩来：**46px 宽、占满标题栏高度、贴右边缘不留内边距**。
 * 这不是抄外观，是抄「屏幕右上角那一格」——鼠标甩到角上就能点到关闭，
 * 是 Windows 用户的肌肉记忆。留了内边距，最大化时那一格就点不中了。
 *
 * 关闭键悬停变红 (#e81123) 也是同一回事：那个红色在 Windows 上就等于「关闭」。
 */

/** 图标画成 10×10 的线稿，缩放时不糊。stroke 用 currentColor 跟随悬停状态。 */
function Glyph({ d, fill = false }: { d: string; fill?: boolean }): ReactElement {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={fill ? 1 : 1}
        strokeLinecap="square"
      />
    </svg>
  )
}

export function WindowControls(): ReactElement {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    // 双击标题栏、Win+↑、拖到屏幕顶端都会改变最大化状态，
    // 渲染层这几条路径一条都感知不到，只能听主进程推。
    return api().onWindowState(setMaximized)
  }, [])

  return (
    <div className="win-controls">
      <button
        className="win-btn"
        title="最小化"
        aria-label="最小化"
        onClick={() => void api().windowMinimize()}
      >
        <Glyph d="M0.5 5.5 H9.5" />
      </button>
      <button
        className="win-btn"
        title={maximized ? '向下还原' : '最大化'}
        aria-label={maximized ? '向下还原' : '最大化'}
        onClick={() => void api().windowToggleMaximize()}
      >
        {maximized ? (
          // 还原：两个叠在一起的方框，和 Windows 一致
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 2.5 H9.5 V9.5 H2.5 Z" fill="none" stroke="currentColor" />
            <path d="M0.5 7.5 V0.5 H7.5" fill="none" stroke="currentColor" />
          </svg>
        ) : (
          <Glyph d="M0.5 0.5 H9.5 V9.5 H0.5 Z" />
        )}
      </button>
      <button
        className="win-btn close"
        title="关闭"
        aria-label="关闭"
        onClick={() => void api().windowClose()}
      >
        <Glyph d="M0.5 0.5 L9.5 9.5 M9.5 0.5 L0.5 9.5" />
      </button>
    </div>
  )
}
