/**
 * 浏览器里单独调 UI 用的假数据。
 *
 * 渲染层平时靠 preload 注入的 window.mtc 取数，那需要整个 Electron 起来。
 * 调样式时不值得每次都等它，所以 window.mtc 不存在时退回这份 fixture，
 * 直接 `pnpm dev:ui` 在浏览器里改。
 *
 * 数据是从 examples/ 里的真实课时抄来的（含那道黄色的应用题），
 * 保证调样式时看到的状态分布和真跑一致。
 */
import type {
  AgentEvent,
  Curriculum,
  EffectiveSettings,
  Lesson,
  LessonMeta,
  LlmSettings,
  MtcApi,
  SettingsSource,
} from '@mtc/shared'

const meta: LessonMeta = {
  id: '人教九上/25-一元二次方程/02-2-公式法',
  textbook: '人教版',
  grade: '九年级上册',
  chapter: '第二十五章 一元二次方程',
  lesson: '25.2.2 公式法',
  standardRefs: ['rj-tp-25-03'],
  periods: 1,
  status: '备课中',
  updatedAt: '2026-08-19T00:00:00Z',
}

const green = (paths: [string, string][]): Lesson['problems'][number]['verify'] => ({
  status: 'green',
  checkedAt: '2026-08-19T12:00:00Z',
  paths: paths.map(([name, detail]) => ({ name, ok: true, detail })),
  log: '',
})

const lesson: Lesson = {
  meta,
  dir: 'C:/Users/demo/MathTeachCopilot/人教九上/25-一元二次方程/02-2-公式法',
  assets: [],
  conversation: [
    {
      id: 't1',
      at: new Date(Date.now() - 26 * 3600_000).toISOString(),
      prompt: '出 8 道分层作业：基础 4 / 提升 3 / 拓展 1',
      summary: '已写入 8 道题：绿 7 / 黄 1。',
      ok: true,
      problemsBefore: 0,
      problemsAfter: 8,
    },
    {
      id: 't2',
      at: new Date(Date.now() - 3 * 3600_000).toISOString(),
      prompt: '第 3 题太难了，换一道同知识点简单些的',
      summary: '这一轮没有产出任何题目（problems.json 仍是 8 道）。',
      ok: false,
      problemsBefore: 8,
      problemsAfter: 8,
    },
  ],
  homework:
    '# 25.2.2 公式法 · 分层作业\n\n## A 基础\n\n**1.** 用公式法解方程 $x^{2}-5x+6=0$。\n\n**2.** 用公式法解方程 $x^{2}+2x-8=0$。\n',
  problems: [
    {
      id: 'p1',
      stem: '用公式法解方程 $x^{2}-5x+6=0$。 ![](assets/bar1.svg)',
      figureRefs: [],
      answer: '$x_{1}=2$，$x_{2}=3$',
      solution: [
        '$a=1$，$b=-5$，$c=6$',
        '$\\Delta=b^{2}-4ac=25-24=1>0$，方程有两个不相等的实数根',
        '$x=\\dfrac{-b\\pm\\sqrt{\\Delta}}{2a}=\\dfrac{5\\pm 1}{2}$',
      ],
      knowledgePointIds: ['rj-tp-25-03'],
      tier: 'A',
      type: '解答',
      verify: green([
        ['sympy.solve', "解集一致：['2', '3']"],
        ['substitute-back', '全部根代回为 0'],
      ]),
      variantSeed: null,
      source: 'generated',
      createdAt: '2026-08-19T12:00:00Z',
    },
    {
      // 选择题：验界面能不能摆出选项、能不能高亮正确项。
      // 光有解答题的话，题型这块改了也看不出来。
      id: 'c1',
      stem: '方程 $x^{2}-4x+4=0$ 的根的情况是（　　）',
      figureRefs: [],
      answer: 'B',
      options: {
        A: '两个不相等的实数根',
        B: '两个相等的实数根',
        C: '没有实数根',
        D: '只有一个实数根',
      },
      solution: ['$\\Delta=b^{2}-4ac=16-16=0$', '判别式为 0，方程有两个相等的实数根'],
      knowledgePointIds: ['rj-tp-25-03'],
      tier: 'A',
      type: '选择',
      check: { kind: 'choice', correct: 'B', basis: { kind: 'manual', reason: '根的情况判断，需教师确认表述' } },
      verify: {
        status: 'yellow',
        checkedAt: '2026-08-21T12:00:00Z',
        paths: [['option-set', '4 个选项，两两互异，正确项 B']].map(([name, detail]) => ({
          name: name!,
          ok: true,
          detail: detail!,
        })),
        log: '选项集合已校验（4 个，两两互异）；正确性需教师确认：根的情况判断，需教师确认表述',
      },
      variantSeed: null,
      source: 'generated',
      createdAt: '2026-08-21T12:00:00Z',
    },
    {
      // 老格式的选择题：选项还在题干里、check 是 manual。
      // 留着它是为了验「从题干提取选项」那个迁移按钮真的能点通——
      // 工作区里有 8 道这样的题，光有解析函数的单测不算验过这条路。
      id: 'legacy1',
      stem: '下列各数：$-8$，$0$，$1.5$，$+20\\%$ 中，正数共有（　　）个\n\nA. 1　　B. 2　　C. 3　　D. 4',
      figureRefs: [],
      answer: 'B',
      // \\% 必须是两个反斜杠：写成 \% 的话 TS 里就是个普通 %，KaTeX 会把它当注释起点，
      // 后面整行公式静默消失
      solution: ['正数是大于 0 的数', '$1.5$ 和 $+20\\%$ 是正数，共 2 个'],
      knowledgePointIds: ['rj-tp-01-01'],
      tier: 'A',
      type: '选择',
      check: { kind: 'manual', reason: '正负数分类概念题，需教师确认 0 的归属' },
      verify: {
        status: 'yellow',
        checkedAt: '2026-08-21T12:00:00Z',
        paths: [],
        log: '正负数分类概念题，需教师确认 0 的归属',
      },
      variantSeed: null,
      source: 'generated',
      createdAt: '2026-08-20T12:00:00Z',
    },
    {
      // 选择题 + 代数依据 -> 绿色，三条路径都跑过
      id: 'c2',
      stem: '$x^{2}-3x+2$ 分解因式的结果是（　　）',
      figureRefs: [],
      answer: 'B',
      options: {
        A: '$(x+1)(x+2)$',
        B: '$(x-1)(x-2)$',
        C: '$(x+1)(x-2)$',
        D: '$(x-1)(x+2)$',
      },
      solution: ['两数之积为 2、之和为 $-3$', '所以 $x^{2}-3x+2=(x-1)(x-2)$'],
      knowledgePointIds: ['rj-tp-25-04'],
      tier: 'A',
      type: '选择',
      check: {
        kind: 'choice',
        correct: 'B',
        basis: { kind: 'identity', left: 'x^2-3*x+2', right: '(x-1)*(x-2)' },
      },
      verify: green([
        ['option-set', '4 个选项，两两互异，正确项 B'],
        ['correct-option', '选项 B：差化简为 0'],
        ['distractors', '其余 3 个选项均不成立'],
      ]),
      variantSeed: null,
      source: 'generated',
      createdAt: '2026-08-21T12:00:00Z',
    },
    {
      id: 'p3',
      stem: '用公式法解方程 $2x^{2}-7x+3=0$。',
      figureRefs: [],
      answer: '$x_{1}=3$，$x_{2}=\\dfrac{1}{2}$',
      solution: ['$a=2$，$b=-7$，$c=3$', '$\\Delta=49-24=25$', '$x=\\dfrac{7\\pm 5}{4}$'],
      knowledgePointIds: ['rj-tp-25-03'],
      tier: 'A',
      type: '解答',
      verify: green([
        ['sympy.solve', "解集一致：['1/2', '3']"],
        ['substitute-back', '全部根代回为 0'],
      ]),
      variantSeed: null,
      source: 'generated',
      createdAt: '2026-08-19T12:00:00Z',
    },
    {
      id: 'p4',
      stem: '先化成一般形式，再用公式法解方程 $3x^{2}=4x+4$。',
      figureRefs: [],
      answer: '$x_{1}=2$，$x_{2}=-\\dfrac{2}{3}$',
      solution: [
        '移项化成一般形式：$3x^{2}-4x-4=0$',
        '$\\Delta=16+48=64$',
        '$x=\\dfrac{4\\pm 8}{6}$',
      ],
      knowledgePointIds: ['rj-tp-25-03'],
      tier: 'B',
      type: '解答',
      verify: green([
        ['sympy.solve', "解集一致：['-2/3', '2']"],
        ['substitute-back', '全部根代回为 0'],
      ]),
      variantSeed: null,
      source: 'generated',
      createdAt: '2026-08-19T12:00:00Z',
    },
    {
      id: 'p6',
      stem: '已知关于 $x$ 的方程 $x^{2}-6x+m=0$ 有两个相等的实数根，求 $m$ 的值，并解此方程。',
      figureRefs: [],
      answer: '$m=9$，$x_{1}=x_{2}=3$',
      solution: ['两根相等则 $\\Delta=0$，即 $36-4m=0$', '解得 $m=9$', '代回得 $x_{1}=x_{2}=3$'],
      knowledgePointIds: ['rj-tp-25-03'],
      tier: 'C',
      type: '解答',
      verify: green([
        ['sympy.solve', "解集一致：['3']"],
        ['substitute-back', '全部根代回为 0'],
      ]),
      variantSeed: null,
      source: 'generated',
      createdAt: '2026-08-19T12:00:00Z',
    },
    {
      id: 'p7',
      stem: '某商品原价 $100$ 元，经过连续两次相同百分率的降价后售价为 $81$ 元，求每次降价的百分率。',
      figureRefs: [],
      answer: '每次降价 $10\\%$',
      solution: [
        '设每次降价的百分率为 $x$，则 $100(1-x)^{2}=81$',
        '$1-x=\\pm 0.9$，解得 $x_{1}=0.1$，$x_{2}=1.9$',
        '降价百分率不能大于 $1$，舍去 $x_{2}=1.9$',
      ],
      knowledgePointIds: ['rj-tp-25-06'],
      tier: 'C',
      type: '解答',
      verify: {
        status: 'yellow',
        checkedAt: '2026-08-19T12:00:00Z',
        paths: [
          { name: 'sympy.solve', ok: true, detail: "解集一致：['0.1', '1.9']" },
          { name: 'substitute-back', ok: true, detail: '全部根代回为 0' },
        ],
        log: '方程本身验算通过，但「舍去 1.9」属于实际意义判断，检查器覆盖不到，需教师确认。',
      },
      variantSeed: null,
      source: 'generated',
      createdAt: '2026-08-19T12:00:00Z',
    },
    {
      id: 'p8',
      stem: '用公式法解方程 $x^{2}-4x+7=0$。',
      figureRefs: [],
      answer: '$x_{1}=2$，$x_{2}=-3$',
      solution: ['$\\Delta=16-28=-12$', '开方得两根'],
      knowledgePointIds: ['rj-tp-25-03'],
      tier: 'B',
      type: '解答',
      verify: {
        status: 'red',
        checkedAt: '2026-08-19T12:00:00Z',
        paths: [
          {
            name: 'sympy.solve',
            ok: false,
            detail: "解集不一致，求解得 ['2 - sqrt(3)*I', '2 + sqrt(3)*I']，声称 ['-3', '2']",
          },
          { name: 'substitute-back', ok: false, detail: '2 代回得 3，不为 0；-3 代回得 28，不为 0' },
        ],
        log: 'sympy.solve: 解集不一致；substitute-back: 根代回不为 0',
      },
      variantSeed: null,
      source: 'generated',
      createdAt: '2026-08-19T12:00:00Z',
    },
  ],
}

/**
 * 教材树用**真实**的 curriculum/*.json，不用假数据。
 *
 * 真实数据是 12 册教材（北师大版 + 人教版各六册）、255 个知识点，假数据只有一套
 * ——左栏能不能扛住这个量，只有喂真数据才看得出来。Vite 在构建期把它们内联进包里。
 */
const realCurricula = Object.values(
  import.meta.glob<Curriculum>('../../../../../curriculum/*.json', { eager: true, import: 'default' }),
)

const fallbackCurriculum: Curriculum = {
  textbook: '人教版',
  grade: '九年级上册',
  source: '演示数据',
  nodes: [
    {
      id: 'rj-ch25',
      title: '第二十五章 一元二次方程',
      knowledgePoints: [
        { id: 'rj-tp-25-01', title: '一元二次方程的概念与一般形式', standard: '', commonErrors: [] },
        { id: 'rj-tp-25-02', title: '配方法', standard: '', commonErrors: [] },
        { id: 'rj-tp-25-03', title: '公式法', standard: '', commonErrors: [] },
        { id: 'rj-tp-25-04', title: '因式分解法', standard: '', commonErrors: [] },
        { id: 'rj-tp-25-05', title: '一元二次方程根与系数的关系', standard: '', commonErrors: [] },
        { id: 'rj-tp-25-06', title: '实际问题与一元二次方程', standard: '', commonErrors: [] },
      ],
    },
  ],
}

const SCRIPT: AgentEvent[] = [
  { type: 'init', tools: [], mcpServers: [{ name: 'mathtools', status: 'connected' }] },
  { type: 'text', text: '先看一下课时的知识点范围，再按 A/B/C 配比出题。' },
  { type: 'tool', name: 'Read' },
  { type: 'tool', name: 'mcp__mathtools__verify_answer_shape' },
  { type: 'text', text: '第 3 题的根是 7/13，数字不便于心算，我调整系数重出一道。' },
  { type: 'tool', name: 'mcp__mathtools__save_problems' },
  { type: 'file', path: 'problems.json', action: 'write' },
  { type: 'file', path: 'homework.md', action: 'write' },
  {
    type: 'done',
    ok: true,
    summary: '已写入 6 道题：绿 4 / 黄 1 / 红 1。红色那道验算不过，已从卷子里排除。',
    // 带上真实量到的数量级，不然「缓存未命中」这行在浏览器里根本看不见
    stats: { ms: 454000, apiMs: 478900, turns: 12, inputTokens: 160817, outputTokens: 4260, cacheReadTokens: 0 },
  },
]

/** 多几个课时，且刻意打乱时间，才能看出「按最近改动倒序」有没有生效 */
const otherLessons: LessonMeta[] = [
  {
    ...meta,
    id: '北师大版九年级上册/第27章 一元二次方程/因式分解法',
    textbook: '北师大版',
    chapter: '第27章 一元二次方程',
    lesson: '因式分解法',
    status: '已定稿',
    updatedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
  },
  {
    ...meta,
    id: '北师大版八年级上册/第13章 勾股定理/勾股定理',
    textbook: '北师大版',
    grade: '八年级上册',
    chapter: '第13章 勾股定理',
    lesson: '勾股定理',
    status: '备课中',
    updatedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
  },
  {
    ...meta,
    id: '北师大版七年级上册/第1章 丰富的图形世界/生活中的立体图形',
    textbook: '北师大版',
    grade: '七年级上册',
    chapter: '第1章 丰富的图形世界',
    lesson: '生活中的立体图形',
    status: '未开始',
    updatedAt: new Date(Date.now() - 5 * 86400_000).toISOString(),
  },
]

// 浏览器里默认「已配好」，否则每次打开都被设置弹窗挡住，验不了别的东西。
// 加 ?unconfigured=1 就能验「首次启动自动弹设置窗」那条路径——
// 那是老师见到的第一个界面，不该只靠读代码确认它对。
const startUnconfigured =
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('unconfigured')

let devSettings: LlmSettings = startUnconfigured
  ? { baseUrl: '', apiKey: '', model: '', imageModel: '' }
  : {
      baseUrl: 'https://kittycat.example.top:12580',
      apiKey: 'sk-dev-fixture',
      model: 'auto/claude-sonnet',
      // 留空：这样浏览器里默认看到的就是「来自默认值」那个状态，
      // 而它才是老师最常见的状态——大多数人不会去改图模型
      imageModel: '',
    }

const DEV_SETTINGS_PATH = 'C:/Users/demo/AppData/Roaming/MathTeachCopilot/settings.json'

/**
 * 来源要照着值算，不能写死成 'settings'。
 *
 * 写死的话字段明明是空的、界面上却不显示「未设置」——这个 fixture 就在骗人，
 * 而它存在的全部意义就是让界面在浏览器里可信。
 */
function devEffective(s: LlmSettings): EffectiveSettings {
  const from = (v: string, fallback?: string): SettingsSource =>
    v.trim() ? 'settings' : fallback ? 'default' : 'none'
  return {
    settings: {
      ...s,
      model: s.model.trim() || 'claude-opus-5',
      imageModel: s.imageModel.trim() || 'codex/gpt-5.6-luna',
    },
    source: {
      baseUrl: from(s.baseUrl),
      apiKey: from(s.apiKey),
      model: from(s.model, 'claude-opus-5'),
      imageModel: from(s.imageModel, 'codex/gpt-5.6-luna'),
    },
    configured: s.apiKey.trim().length > 0,
    filePath: DEV_SETTINGS_PATH,
  }
}

export const devApi: MtcApi = {
  // 浏览器里没有窗口可控。做成空实现而不是报错——按钮点了没反应是对的，
  // 在浏览器里调界面时不该因为点了「最小化」就弹一个异常出来。
  windowMinimize: async () => undefined,
  windowToggleMaximize: async () => undefined,
  windowClose: async () => undefined,
  onWindowState: () => () => undefined,
  getSettings: async () => devEffective(devSettings),
  saveSettings: async (s) => {
    devSettings = s
    return devEffective(s)
  },
  testLlm: async (s) => {
    await new Promise((r) => setTimeout(r, 700))
    return s.apiKey
      ? { ok: true, ms: 4200, detail: '模型回了「好」' }
      : { ok: false, detail: '没填 API Key' }
  },
  // 名字照抄真网关列出来的那五个：假数据太短太整齐的话，
  // 界面上那排 chip 换不换行、长名字会不会撑破弹窗，在浏览器里就验不出来
  listImageModels: async (s) => {
    await new Promise((r) => setTimeout(r, 500))
    if (!s.apiKey) return { ok: false, detail: '没填 API Key' }
    if (!s.baseUrl) {
      return { ok: false, detail: 'Anthropic 官方 API 没有生图接口。情境插图需要一个提供图模型的网关。' }
    }
    const models = [
      'codex/gpt-5.6-sol',
      'codex/gpt-5.6-terra',
      'codex/gpt-5.6-luna',
      'chatgpt-web/gpt-5.5',
      'antigravity/gemini-3.1-flash-image',
    ]
    return { ok: true, models, detail: `网关上有 ${models.length} 个图模型` }
  },
  listLessons: async () => [
    // 故意乱序返回：排序是 LessonPane 的职责，不该依赖后端顺序
    otherLessons[2]!,
    { ...meta, status: '备课中', updatedAt: new Date(Date.now() - 90_000).toISOString() },
    otherLessons[0]!,
    otherLessons[1]!,
  ],
  // **必须按 id 返回对应的课时**：都返回同一个的话，current.meta.id 永远不变，
  // 「事件按课时隔离」这类 bug 在浏览器里根本验不出来（踩过一次）。
  readLesson: async (id) => {
    if (id === meta.id) return lesson
    const m = otherLessons.find((l) => l.id === id)
    return {
      ...lesson,
      meta: m ?? { ...meta, id },
      // 别的课时给一份不同的内容，切换时能一眼看出确实换了
      problems: lesson.problems.slice(0, 2),
      conversation: [],
      homework: null,
    }
  },
  loadCurriculum: async () =>
    realCurricula.length > 0 ? realCurricula : [fallbackCurriculum],
  // 浏览器里没有文件系统，只回一个假 id 让交互能走通
  createLesson: async (req) => `演示/${req.chapterTitle}/${req.knowledgePointTitle}`,
  readFigure: async () => null,
  saveAttachment: async (_id, name) => `assets/upload-demo-${name}`,
  exportDocx: async () => ({ ok: false, error: '浏览器里没有文件系统，导出请在应用里试' }),
  deleteProblem: async () => {},
  updateProblem: async () => ({ ok: true }),
  setLessonStatus: async () => {},
  runAgent: async (req) => {
    for (const [i, event] of SCRIPT.entries()) {
      setTimeout(() => listeners.forEach((cb) => cb(req.lessonId, event)), 350 * (i + 1))
    }
  },
  interruptAgent: async () => {},
  onAgentEvent: (cb) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
  // 浏览器里没有主进程，也就没有文件监听
  onLessonChanged: () => () => {},
}

const listeners = new Set<(lessonId: string, e: AgentEvent) => void>()

/** 订阅类方法缺失时的安全替身：什么都不做，但不能抛错 */
const noopUnsubscribe = (): (() => void) => () => {}

/**
 * 数据类方法缺失时的替身：明确失败，但不在 useEffect 里同步抛错。
 * 同步抛错会让 React 卸载整棵树，界面就变成「看得见、点不动」。
 */
const rejecting =
  (name: string) =>
  async (): Promise<never> => {
    throw new Error(`preload 没有提供 ${name}——preload 与渲染层版本不一致，请完全退出应用后重启`)
  }

const STUBS: MtcApi = {
  windowMinimize: rejecting('windowMinimize'),
  windowToggleMaximize: rejecting('windowToggleMaximize'),
  windowClose: rejecting('windowClose'),
  onWindowState: () => () => undefined,
  getSettings: rejecting('getSettings'),
  saveSettings: rejecting('saveSettings'),
  testLlm: rejecting('testLlm'),
  listImageModels: rejecting('listImageModels'),
  listLessons: rejecting('listLessons'),
  readLesson: rejecting('readLesson'),
  loadCurriculum: rejecting('loadCurriculum'),
  createLesson: rejecting('createLesson'),
  readFigure: rejecting('readFigure'),
  saveAttachment: rejecting('saveAttachment'),
  exportDocx: rejecting('exportDocx'),
  deleteProblem: rejecting('deleteProblem'),
  updateProblem: rejecting('updateProblem'),
  setLessonStatus: rejecting('setLessonStatus'),
  runAgent: rejecting('runAgent'),
  interruptAgent: rejecting('interruptAgent'),
  onAgentEvent: noopUnsubscribe,
  onLessonChanged: noopUnsubscribe,
}

/**
 * window.mtc 不存在（浏览器里裸跑）时退回 fixture。
 *
 * 存在但**缺方法**时逐个补替身，而不是直接用——开发时改了 IPC 契约、
 * Electron 还跑着旧 preload，就会缺方法；直接调用会在 useEffect 里抛错，
 * 后果是整个界面点不动且毫无提示。宁可降级也不要死界面。
 */
export function api(): MtcApi {
  const injected = typeof window !== 'undefined' ? window.mtc : undefined
  if (!injected) return devApi

  const missing = (Object.keys(STUBS) as (keyof MtcApi)[]).filter(
    (k) => typeof injected[k] !== 'function',
  )
  if (missing.length === 0) return injected

  console.warn('[mtc] preload 缺少这些方法，已降级：', missing.join(', '))
  const patched = { ...injected } as Record<string, unknown>
  for (const k of missing) patched[k] = STUBS[k]
  return patched as unknown as MtcApi
}

export const isDevFixture = (): boolean =>
  typeof window === 'undefined' || !window.mtc
