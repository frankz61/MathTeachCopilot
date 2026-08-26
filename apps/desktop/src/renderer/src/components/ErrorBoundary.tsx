import { Component, type ErrorInfo, type ReactElement, type ReactNode } from 'react'

/**
 * 渲染层的错误兜底。
 *
 * 没有它的时候，useEffect 里随便抛一个错，React 就把整棵树卸载掉——
 * 窗口还在、内容还画着（上一帧的像素），但什么都点不动，而且没有任何提示。
 * 真踩过一次：preload 和渲染层版本对不上，`api().onLessonChanged` 不存在，
 * 表现就是「界面点不动」，排查方向完全被带偏。
 *
 * 宁可显示一屏难看的错误，也不要让人对着一个死界面猜。
 */
interface State {
  error: Error | null
  info: string
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null, info: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[mtc] 渲染层崩了', error, info)
    this.setState({ info: info.componentStack ?? '' })
  }

  override render(): ReactNode {
    const { error, info } = this.state
    if (!error) return this.props.children

    return (
      <div className="crash">
        <h1>界面出错了</h1>
        <p className="crash-msg">{error.message}</p>
        <p className="crash-hint">
          如果消息里提到 <code>window.mtc</code> 或某个方法不存在，多半是 preload
          和渲染层版本对不上——完全退出应用再 <code>pnpm dev</code> 重启即可。
        </p>
        <button className="send" onClick={() => this.setState({ error: null, info: '' })}>
          重试
        </button>
        {info && <pre className="crash-stack">{info.trim()}</pre>}
      </div>
    )
  }
}
