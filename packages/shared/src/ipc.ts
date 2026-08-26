/** 主进程 ↔ 渲染进程的契约。preload 只暴露这里列出的东西。 */
import type { Lesson, LessonMeta, LessonStatus } from './lesson.js'
import type { Problem } from './problem.js'
import type { Curriculum } from './curriculum.js'
import type {
  EffectiveSettings,
  ImageModelList,
  LlmSettings,
  LlmTestResult,
} from './settings.js'

export const IPC = {
  listLessons: 'workspace:listLessons',
  readLesson: 'workspace:readLesson',
  loadCurriculum: 'curriculum:load',
  createLesson: 'workspace:createLesson',
  readFigure: 'workspace:readFigure',
  saveAttachment: 'workspace:saveAttachment',
  exportDocx: 'workspace:exportDocx',
  deleteProblem: 'workspace:deleteProblem',
  updateProblem: 'workspace:updateProblem',
  setLessonStatus: 'workspace:setLessonStatus',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggleMaximize',
  windowClose: 'window:close',
  windowState: 'window:state',
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  testLlm: 'settings:testLlm',
  listImageModels: 'settings:listImageModels',
  runAgent: 'agent:run',
  interruptAgent: 'agent:interrupt',
  agentEvent: 'agent:event',
  lessonChanged: 'workspace:lessonChanged',
} as const

/** 主进程推给 UI 的 agent 事件。刻意收窄，不把 SDK 的原始消息透给渲染层。 */
/**
 * 一轮跑完的耗时账单。
 *
 * 加这个是因为「感觉有点慢」没法排查——慢在模型、慢在网关、还是慢在我们自己
 * 发了太多轮请求，光看总时长分不出来。turns 是关键：每一轮都是一次完整的
 * 网络往返，网关每次的固定开销会被乘以它。
 */
export interface RunStats {
  /** 端到端墙上时间 */
  ms: number
  /** 其中花在等模型响应上的时间 */
  apiMs?: number
  /** 来回了几轮。这是固定开销的乘数 */
  turns?: number
  inputTokens?: number
  outputTokens?: number
  /** 命中提示词缓存的 token。为 0 或缺失说明缓存没生效，每轮都在重发全量上下文 */
  cacheReadTokens?: number
}

export type AgentEvent =
  | { type: 'init'; tools: string[]; mcpServers: { name: string; status: string }[] }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'file'; path: string; action: 'write' | 'edit' }
  | { type: 'done'; ok: boolean; summary: string; stats?: RunStats }
  | { type: 'error'; message: string }

/** 从教材树上点一个知识点，建出对应的课时文件夹 */
export interface CreateLessonRequest {
  textbook: string
  grade: string
  chapterTitle: string
  knowledgePointId: string
  knowledgePointTitle: string
}

export interface ExportRequest {
  lessonId: string
  withAnswers: boolean
}

export interface ExportResult {
  ok: boolean
  /** 用户在保存对话框里点了取消 */
  canceled?: boolean
  path?: string
  exported?: number
  /** 被闸门拦下的题：红色或未验证 */
  blocked?: { id: string; reason: string }[]
  error?: string
}

export interface UpdateProblemResult {
  ok: boolean
  /** 校验没过时逐条说明哪里不合规 */
  errors?: string[]
  /** 改完验算不过：旧题原样保留，这里说明为什么没保存 */
  rejected?: { id: string; reason: string }[]
}

export interface AgentRunRequest {
  /** 课时目录相对工作区根的路径，agent 的 cwd 就是它 */
  lessonId: string
  /**
   * 老师随这句话一起上传的图片，相对课时目录的路径（如 assets/upload-xxx.png）。
   *
   * 不走内存塞进提示词，而是先落进课时目录、再让 Agent 用 Read 看：
   * 图片因此成为工作区的一部分——能被当成题目配图复用、能导出、老师也能直接打开。
   */
  attachments?: string[]
  /** 走哪个 Skill。第一版只有 problems */
  skill: 'problems'
  prompt: string
}

export interface MtcApi {
  listLessons(): Promise<LessonMeta[]>
  readLesson(lessonId: string): Promise<Lesson>
  loadCurriculum(): Promise<Curriculum[]>
  /** 已存在则直接返回它的 id，不覆盖已有内容 */
  createLesson(req: CreateLessonRequest): Promise<string>
  /**
   * 读课时目录下的插图，返回可直接塞进 <img src> 的 data URI。
   *
   * 不用 file:// —— 渲染层的 CSP 是 default-src 'self'，file:// 会被拦掉，
   * 表现是图裂掉而且没有报错。走 data URI 最省事也最稳。
   */
  readFigure(lessonId: string, ref: string): Promise<string | null>
  /** 保存一张上传的图片到课时的 assets/，返回相对路径 */
  saveAttachment(lessonId: string, fileName: string, dataUri: string): Promise<string | null>
  /** 导出 Word。会弹保存对话框；红色和未验证的题由 Python 层的闸门拦下。 */
  exportDocx(req: ExportRequest): Promise<ExportResult>
  /** 剔除一道题。老师的判断优先于 Agent 的产出。 */
  deleteProblem(lessonId: string, problemId: string): Promise<void>
  /**
   * 保存老师改过的一道题。
   *
   * **保存时会重新验算**——改了答案而验证戳还挂着绿色，等于产品在撒谎。
   * 走的是和 Agent 完全一样的闸门。
   */
  updateProblem(lessonId: string, problem: Problem): Promise<UpdateProblemResult>
  setLessonStatus(lessonId: string, status: LessonStatus): Promise<void>
  /**
   * 窗口控件。窗口是无边框的，所以最小化/最大化/关闭得自己画、自己接。
   *
   * 这三个必须走 IPC：渲染层没有 remote 也拿不到 BrowserWindow，
   * `window.close()` 在 Electron 里也不等于关窗口。
   */
  windowMinimize(): Promise<void>
  windowToggleMaximize(): Promise<void>
  windowClose(): Promise<void>
  /**
   * 窗口最大化状态变了。
   *
   * 必须是推送而不是查询：双击标题栏、Win+↑、拖到屏幕顶端都会改变状态，
   * 这些路径渲染层一个都感知不到，只能等主进程告诉它，否则那个
   * 「最大化/还原」图标就会和实际状态对不上。
   */
  onWindowState(cb: (maximized: boolean) => void): () => void
  /** 当前生效的模型接入设置，含逐项来源和「够不够用」 */
  getSettings(): Promise<EffectiveSettings>
  /** 写设置文件，返回写完后重新解析的结果 */
  saveSettings(s: LlmSettings): Promise<EffectiveSettings>
  /**
   * 真的发一次最小请求试试。
   *
   * 「填对了吗」只能靠实打一次——地址少一段、别名网关上不存在、密钥过期，
   * 三种都只会在真正出题时才暴露，那时候老师已经等了几分钟。
   */
  testLlm(s: LlmSettings): Promise<LlmTestResult>
  /**
   * 问网关有哪些图模型。只是一次 GET，不出图、不花钱。
   *
   * 图模型名没法猜（`codex/gpt-5.6-luna` 这种），填错的唯一症状是
   * 四十秒后一个 400。列出来让老师点，比让他背一个名字靠谱。
   */
  listImageModels(s: LlmSettings): Promise<ImageModelList>
  runAgent(req: AgentRunRequest): Promise<void>
  interruptAgent(): Promise<void>
  /**
   * Agent 事件。**带 lessonId**——一次只跑一个课时，但老师会一边等一边去看别的课时，
   * 事件不标明归属就会串台：切过去还显示上一节的记录和「生成中」。
   */
  onAgentEvent(cb: (lessonId: string, e: AgentEvent) => void): () => void
  /**
   * 课时目录里的文件变了。
   *
   * 主进程监听目录，谁写的都算——Agent、老师用别的编辑器改的、外部拷进来的。
   * 不要靠 agent 的 file 事件来刷新：那是「发起工具调用」的时刻，不是落盘的时刻。
   */
  onLessonChanged(cb: (lessonId: string) => void): () => void
}
