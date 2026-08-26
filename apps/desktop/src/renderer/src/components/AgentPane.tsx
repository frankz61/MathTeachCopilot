import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { AgentEvent, ConversationTurn, RunStats } from '@mtc/shared'
import { Lightbox } from './Lightbox.js'

interface Props {
  /** 这个课时的提问历史，新的在后 */
  history: ConversationTurn[]
  events: AgentEvent[]
  busy: boolean
  disabled: boolean
  onRun: (prompt: string, attachments: string[]) => void
  /** 把一张图片存进课时目录，返回相对路径 */
  onAttach: (file: File) => Promise<string | null>
  onInterrupt: () => void
}

/** 老师会说的话，不是程序员的 slash command。见 docs/grok.md 第七节。 */
const QUICK_ASKS = [
  '出 8 道分层作业：基础 4 / 提升 3 / 拓展 1',
  '第 3 题太难了，换一道同知识点简单些的',
  '按现在的题再各出一道同源变式，数字换掉',
]

function turnClass(t: ConversationTurn): string {
  if (t.ok === null) return 'turn-pending'
  return t.ok ? 'turn-ok' : 'turn-bad'
}

function shortTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const sameDay = new Date().toDateString() === d.toDateString()
  return sameDay
    ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

/** mcp__mathtools__verify_algebra → verify_algebra，老师不需要看见前缀 */
function shortToolName(name: string): string {
  const parts = name.split('__')
  return parts[parts.length - 1] ?? name
}

export function AgentPane({
  history,
  events,
  busy,
  disabled,
  onRun,
  onAttach,
  onInterrupt,
}: Props): ReactElement {
  const [input, setInput] = useState('')
  const [pending, setPending] = useState<{ ref: string; name: string; url: string }[]>([])
  const [zoom, setZoom] = useState<{ url: string; name: string } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // 卸载时要释放 objectURL，但清理函数只跑一次，闭包拿不到最新的 pending
  const pendingRef = useRef<{ ref: string; name: string; url: string }[]>([])
  pendingRef.current = pending
  const endRef = useRef<HTMLDivElement>(null)

  /** 拍照的题、教材截图、学生作业——都是从这儿进来的 */
  const takeFiles = async (files: FileList | File[] | null): Promise<void> => {
    const images = [...(files ?? [])].filter((f) => f.type.startsWith('image/'))
    if (images.length === 0 || disabled) return
    setAttaching(true)
    for (const f of images) {
      const ref = await onAttach(f)
      // 本地 objectURL 直接拿来做缩略图和大图，不用再从磁盘读一遍
      if (ref) {
        setPending((prev) => [...prev, { ref, name: f.name || '图片', url: URL.createObjectURL(f) }])
      }
    }
    setAttaching(false)
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [events, busy])

  // 卸载时兜底释放，切课时会重建这个组件
  useEffect(
    () => () => {
      for (const a of pendingRef.current) URL.revokeObjectURL(a.url)
    },
    [],
  )

  const submit = (text: string): void => {
    const t = text.trim()
    // 只贴了图没打字也应该能发——「这道题录进来」是老师最常见的意图
    if ((!t && pending.length === 0) || busy || disabled) return
    onRun(t || '看看这张图，按上面的规矩处理。', pending.map((p) => p.ref))
    setInput('')
    // 释放缩略图的 objectURL —— 图已经落盘了，这几个只是预览用的内存引用
    for (const a of pending) URL.revokeObjectURL(a.url)
    setPending([])
  }

  const idle = events.length === 0 && !busy

  return (
    <>
      <h2 className="pane-title">协作</h2>

      <div className="events">
        {/* 历史一直显示：老师会想「上次那句话是怎么说的」，点一下就能重用。
            没有它的话每次运行都清空，等于每次从零开始。 */}
        {history.length > 0 && (
          <div className="history">
            {history.map((t) => (
              <button
                key={t.id}
                className="turn"
                disabled={busy}
                title="点击重新发送这句话"
                onClick={() => submit(t.prompt)}
              >
                <span className="turn-head">
                  <span className={`turn-dot ${turnClass(t)}`} />
                  <span className="turn-time">{shortTime(t.at)}</span>
                  {t.problemsAfter !== null && t.problemsAfter !== t.problemsBefore && (
                    <span className="turn-delta tabular">
                      +{t.problemsAfter - t.problemsBefore} 道
                    </span>
                  )}
                </span>
                <span className="turn-prompt">{t.prompt}</span>
              </button>
            ))}
          </div>
        )}

        {idle && (
          <div className="quick">
            <p className="quick-hint">
              {disabled ? '先选一个课时' : history.length > 0 ? '或者试试：' : '试试这些：'}
            </p>
            {QUICK_ASKS.map((q) => (
              <button key={q} disabled={disabled} onClick={() => submit(q)}>
                {q}
              </button>
            ))}
          </div>
        )}
        {events.map((e, i) => (
          <EventRow key={i} event={e} />
        ))}
        {busy && (
          <div className="working">
            <span className="pulse" />
            正在处理…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div
        className={dragging ? 'composer dragging' : 'composer'}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void takeFiles(e.dataTransfer.files)
        }}
      >
        {pending.length > 0 && (
          <div className="attachments">
            {pending.map((a) => (
              <span key={a.ref} className="attach-thumb" title={a.name}>
                {/* 缩略图看不清刻度和字，得能点开看大图再决定要不要用 */}
                <img
                  src={a.url}
                  alt={a.name}
                  onClick={() => setZoom({ url: a.url, name: a.name })}
                />
                <button
                  className="attach-x"
                  title="移除"
                  onClick={() => {
                    URL.revokeObjectURL(a.url)
                    setPending((prev) => prev.filter((p) => p.ref !== a.ref))
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          value={input}
          disabled={disabled || busy}
          placeholder={disabled ? '先选一个课时' : '说说这节课要留什么作业…'}
          onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.items]
              .filter((i) => i.kind === 'file')
              .map((i) => i.getAsFile())
              .filter((f): f is File => f !== null)
            if (files.length > 0) {
              e.preventDefault()
              void takeFiles(files)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(input)
          }}
        />
        <div className="composer-row">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void takeFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            className="attach-btn"
            disabled={disabled || busy || attaching}
            title="拍照的题、教材截图、学生作业都可以，也能直接粘贴或拖进来"
            onClick={() => fileRef.current?.click()}
          >
            {attaching ? '读取中…' : '＋ 图片'}
          </button>
          <kbd>Ctrl + Enter 发送</kbd>
          <span className="spacer" />
          {busy ? (
            <button className="interrupt" onClick={onInterrupt}>
              中断
            </button>
          ) : (
            <button
              className="send"
              disabled={disabled || (!input.trim() && pending.length === 0)}
              onClick={() => submit(input)}
            >
              发送
            </button>
          )}
        </div>
      </div>

      {zoom && <Lightbox src={zoom.url} caption={zoom.name} onClose={() => setZoom(null)} />}
    </>
  )
}

/**
 * 一行耗时账单。
 *
 * 「怎么这么慢」是个没法靠感觉回答的问题：同样是 5 分钟，可能是模型在慢慢想，
 * 也可能是来回了十几轮、每轮都在等网关。不把轮数摆出来，就只会一直换模型碰运气。
 */
function Bill({ stats }: { stats: RunStats }): ReactElement | null {
  const parts = [`${(stats.ms / 1000).toFixed(0)} 秒`]
  if (stats.turns) parts.push(`${stats.turns} 轮往返`)
  if (stats.inputTokens) parts.push(`入 ${(stats.inputTokens / 1000).toFixed(0)}k token`)
  // 缓存没命中意味着每一轮都在重发整套系统提示。同一个网关上换个别名就可能有缓存，
  // 所以这行出现时该先怀疑模型别名，而不是笼统归咎于网关
  if (stats.inputTokens && !stats.cacheReadTokens) parts.push('缓存未命中')
  return <div className="ev-bill tabular">{parts.join(' · ')}</div>
}

function EventRow({ event }: { event: AgentEvent }): ReactElement {
  switch (event.type) {
    case 'init': {
      const bad = event.mcpServers.filter((s) => s.status !== 'connected')
      return (
        <div className="ev ev-init">
          <span className={`dot ${bad.length ? 'dot-red' : 'dot-green'}`} />
          {bad.length ? `工具未就绪：${bad.map((s) => s.name).join('、')}` : '数学工具已就绪'}
        </div>
      )
    }
    case 'text':
      return <div className="ev ev-text">{event.text}</div>
    case 'tool':
      return (
        <div className="ev ev-tool">
          <span className="tick" />
          <code>{shortToolName(event.name)}</code>
        </div>
      )
    case 'file':
      return (
        <div className="ev ev-file">
          <span>{event.action === 'edit' ? '✎' : '＋'}</span>
          {event.path.split(/[\\/]/).pop()}
        </div>
      )
    case 'done':
      return (
        <div className={event.ok ? 'ev ev-done' : 'ev ev-error'}>
          {event.summary}
          {event.stats && <Bill stats={event.stats} />}
        </div>
      )
    case 'error':
      return <div className="ev ev-error">{event.message}</div>
  }
}
