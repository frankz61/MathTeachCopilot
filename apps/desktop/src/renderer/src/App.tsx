import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type {
  AgentEvent,
  Curriculum,
  EffectiveSettings,
  KnowledgePoint,
  Lesson,
  LessonMeta,
  Problem,
  UpdateState,
} from '@mtc/shared'
import { LessonPane } from './components/LessonPane.js'
import { ArtifactPane } from './components/ArtifactPane.js'
import { AgentPane } from './components/AgentPane.js'
import { SettingsDialog } from './components/SettingsDialog.js'
import { WindowControls } from './components/WindowControls.js'
import { api, isDevFixture } from './devFixture.js'

/**
 * 三栏。左=教材树与课时，中=产物，右=Agent。
 * 不做成纯聊天，见 docs/claude.md 第五节。
 */
export function App(): ReactElement {
  const [curricula, setCurricula] = useState<Curriculum[]>([])
  const [lessons, setLessons] = useState<LessonMeta[]>([])
  const [current, setCurrent] = useState<Lesson | null>(null)
  /**
   * 事件按课时分开存。
   *
   * 原来是一个全局数组，切到别的课时还显示上一节的记录——老师一边等生成
   * 一边去看下一节课，看到的是串台的内容。
   */
  const [eventsByLesson, setEventsByLesson] = useState<Record<string, AgentEvent[]>>({})
  /** 正在跑哪个课时。主进程一次只允许跑一个，所以一个 id 就够。 */
  const [busyLesson, setBusyLesson] = useState<string | null>(null)
  /** null = 还没读到。读到之前不弹设置窗，否则每次启动都闪一下。 */
  const [settings, setSettings] = useState<EffectiveSettings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** 更新状态。启动时主进程静默查 + 后台下，这里只负责把进展亮出来 */
  const [update, setUpdate] = useState<UpdateState | null>(null)

  // 当前课时 id 放 ref：事件回调只订阅一次，不能靠闭包里的 state
  const currentId = useRef<string | null>(null)

  const reload = useCallback((lessonId: string) => {
    if (lessonId !== currentId.current) return // 已经切走了，丢弃这次刷新
    void api()
      .readLesson(lessonId)
      .then((lesson) => {
        // 异步返回时可能又切走了，再确认一次，避免把旧课时盖到新课时上
        if (lessonId === currentId.current) setCurrent(lesson)
      })
  }, [])

  useEffect(() => {
    void api().loadCurriculum().then(setCurricula)
    void api().listLessons().then(setLessons)

    // 开机自检：没配模型接入的话整个软件的主要功能都用不了，直接把设置窗打开。
    // 只在启动时弹一次——之后靠顶栏那条提示，不反复挡住老师。
    void api()
      .getSettings()
      .then((e) => {
        setSettings(e)
        if (!e.configured) setSettingsOpen(true)
      })
      .catch(() => {
        // 读不到设置多半是 preload 版本不一致（见 devFixture 的 STUBS）。
        // 这里不弹窗，让 ErrorBoundary 或顶栏提示去说明，别叠两层错误。
      })

    const offAgent = api().onAgentEvent((lessonId, e) => {
      setEventsByLesson((prev) => ({ ...prev, [lessonId]: [...(prev[lessonId] ?? []), e] }))
      if (e.type === 'done' || e.type === 'error') {
        setBusyLesson((cur) => (cur === lessonId ? null : cur))
      }
    })

    // 刷新只认文件监听，不认 agent 的 file 事件——那个是发起调用的时刻，
    // 文件还没落盘，读到的会是旧内容。见 src/main/watcher.ts。
    const offWatch = api().onLessonChanged((lessonId) => reload(lessonId))
    const offUpdate = api().onUpdateState(setUpdate)

    return () => {
      offAgent()
      offWatch()
      offUpdate()
    }
  }, [reload])

  const openLesson = useCallback((id: string) => {
    currentId.current = id
    void api()
      .readLesson(id)
      .then((lesson) => {
        if (id === currentId.current) setCurrent(lesson)
      })
  }, [])

  /** 点教材树上的知识点：没课时就建一个，有就直接打开，然后刷新课时列表 */
  const pickKnowledgePoint = useCallback(
    (textbook: string, grade: string, chapterTitle: string, kp: KnowledgePoint) => {
      void api()
        .createLesson({
          textbook,
          grade,
          chapterTitle,
          knowledgePointId: kp.id,
          knowledgePointTitle: kp.title,
        })
        .then(async (lessonId) => {
          setLessons(await api().listLessons())
          openLesson(lessonId)
        })
    },
    [openLesson],
  )

  const run = useCallback(
    (prompt: string, attachments: string[] = []) => {
      if (!current) return
      const lessonId = current.meta.id
      setBusyLesson(lessonId)
      setEventsByLesson((prev) => ({ ...prev, [lessonId]: [] }))
      void api()
        .runAgent({ lessonId, skill: 'problems', prompt, attachments })
        .catch((err: unknown) => {
          // 不 catch 的话：主进程在发出任何事件前抛错时，这个 promise 静默 reject，
          // busy 永远卡在 true —— 之后所有按钮都是禁用的，表现就是「按钮没用」。
          const msg = `启动失败：${err instanceof Error ? err.message : String(err)}`
          setEventsByLesson((prev) => ({
            ...prev,
            [lessonId]: [...(prev[lessonId] ?? []), { type: 'error', message: msg }],
          }))
          setBusyLesson((cur) => (cur === lessonId ? null : cur))
        })
    },
    [current],
  )

  /**
   * 出变式。[claude.md](docs/claude.md) 第四节把「变式生成器」列为最高价值的功能，
   * 但它此前只存在于 variantSeed 字段里，没有任何入口。
   *
   * 提示词里带上原题的关键信息，Agent 就不用先去读一遍 problems.json。
   */
  /** 变式的提示词由 VariantDialog 拼好（老师选了数量、方向、分层），这里只管发 */
  const variant = useCallback((prompt: string) => run(prompt), [run])

  /** 把一张图存进课时目录，交给 Agent 用 Read 看 */
  const attach = useCallback(
    async (file: File): Promise<string | null> => {
      if (!current) return null
      const dataUri = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = () => reject(new Error('读取文件失败'))
        r.readAsDataURL(file)
      })
      return api().saveAttachment(current.meta.id, file.name, dataUri)
    },
    [current],
  )

  const removeProblem = useCallback(
    (problemId: string) => {
      if (!current) return
      // 删完不用手动刷新：主进程在监听课时目录，写盘会自动推 lessonChanged
      void api().deleteProblem(current.meta.id, problemId)
    },
    [current],
  )

  return (
    <div className="app">
      <header className="titlebar">
        <span className="brand">
          {/* 和应用图标同一个记号：根号既是数学符号，又长得就是对勾 */}
          <span className="brand-mark" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 100 100">
              <path
                d="M14 50 L32 78 L58 19 L87 19"
                fill="none"
                stroke="currentColor"
                strokeWidth="13"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          MathTeachCopilot
        </span>
        {current ? (
          <span className="crumb">
            <span>{current.meta.textbook}</span>
            <span className="sep">/</span>
            <span>{current.meta.chapter}</span>
            <span className="sep">/</span>
            <span className="cur">{current.meta.lesson}</span>
          </span>
        ) : (
          <span className="crumb">未选择课时</span>
        )}
        <span className="spacer" />
        {isDevFixture() && <span className="dev-flag">演示数据</span>}
        {/* 更新提示只在「下载中 / 已就绪」两个状态出现。查失败不打扰——
            学校网络到 GitHub 不通是常态，每次启动都在顶栏挂一条红的，
            只会让老师学会无视顶栏。错误细节留在设置窗里看。 */}
        {update?.status === 'downloading' && (
          <span className="update-chip" title={`新版本 ${update.newVersion} 正在后台下载`}>
            新版本 {update.newVersion} 下载中 {Math.round(update.percent)}%
          </span>
        )}
        {update?.status === 'ready' && (
          <button
            className="update-chip actionable"
            title={`已下载 ${update.newVersion}，点击重启并安装。现在不点，退出时也会装上。`}
            onClick={() => void api().installUpdate()}
          >
            重启安装新版本
          </button>
        )}
        <button
          className={settings && !settings.configured ? 'settings-btn need' : 'settings-btn'}
          title="网关地址、API Key、模型、图模型"
          onClick={() => setSettingsOpen(true)}
        >
          设置
        </button>
        <WindowControls />
      </header>

      {/* 没配好就一直显示。挡不住操作，但也不给「关掉」——关掉之后老师
          只会看到「启动失败」而不知道要去哪儿填。 */}
      {settings && !settings.configured && (
        <div className="setup-banner">
          <strong>还没设置模型接入</strong>
          <span>填好网关地址和 API Key 才能出题。设置存在本机，不会跟着课件走。</span>
          <button className="primary-btn" onClick={() => setSettingsOpen(true)}>
            去设置
          </button>
        </div>
      )}

      <div className="panes">
        <aside className="pane pane-left">
          <LessonPane
            curricula={curricula}
            lessons={lessons}
            busyLesson={busyLesson}
            currentId={current?.meta.id ?? null}
            currentTextbook={current?.meta.textbook ?? null}
            currentGrade={current?.meta.grade ?? null}
            onOpen={openLesson}
            onPickKnowledgePoint={pickKnowledgePoint}
          />
        </aside>

        <main className="pane pane-center">
          <ArtifactPane
            lesson={current}
            busy={busyLesson === current?.meta.id}
            onVariant={variant}
            onDelete={removeProblem}
          />
        </main>

        <aside className="pane pane-right">
          <AgentPane
            history={current?.conversation ?? []}
            events={current ? (eventsByLesson[current.meta.id] ?? []) : []}
            busy={busyLesson === current?.meta.id}
            disabled={!current}
            onRun={run}
            onAttach={attach}
            onInterrupt={() => void api().interruptAgent()}
          />
        </aside>
      </div>

      {settingsOpen && (
        <SettingsDialog onClose={() => setSettingsOpen(false)} onSaved={setSettings} />
      )}
    </div>
  )
}
