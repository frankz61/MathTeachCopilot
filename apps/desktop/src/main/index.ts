import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import {
  IPC,
  type AgentEvent,
  type AgentRunRequest,
  type CreateLessonRequest,
  type ExportRequest,
  type ExportResult,
  type LessonStatus,
  type LlmSettings,
} from '@mtc/shared'
import { Workspace, loadCurriculum } from '@mtc/workspace'
import { findKnowledgePoint } from '@mtc/shared'
import { runAgent, type RunHandle } from './agent.js'
import { LessonWatcher } from './watcher.js'
import { runPyTool } from './pytool.js'
import { listImageModels, resolveEffective, testLlm, writeSettings } from './settings.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * 教师工作区。一个课时 = 一个文件夹，老师能直接打开、拷给同事。
 * 见 docs/architecture.md 第六节。
 */
const workspaceRoot = path.join(app.getPath('home'), 'MathTeachCopilot')
const workspace = new Workspace(workspaceRoot)

/** 教材树是随包分发的只读配置，不在教师工作区里 */
const curriculumDir = app.isPackaged
  ? path.join(process.resourcesPath, 'curriculum')
  : path.resolve(__dirname, '../../../../curriculum')

const baseDir = app.isPackaged ? process.resourcesPath : __dirname
/** 开发期这里有 .env；打包后没有，配置全部来自设置界面写的 userData/settings.json */
const configRoot = app.isPackaged
  ? process.resourcesPath
  : path.resolve(__dirname, '../../../..')

/**
 * 设置文件放 userData，不放工作区。
 *
 * 工作区是老师的内容，会被整个拷给同事、放网盘、拖 U 盘——密钥不能跟着课件跑。
 * 见 settings.ts 开头的说明。
 */
const userDataDir = app.getPath('userData')

/**
 * 窗口图标。只服务开发期——打包后 Windows 直接用 exe 里嵌的那份，
 * 这里再指一次没有意义，路径还容易指错。
 */
const appIcon = app.isPackaged
  ? undefined
  : path.resolve(__dirname, '../../build/icon.png')

/** 当前生效的模型接入配置，逐项带来源 */
function effective(): ReturnType<typeof resolveEffective> {
  return resolveEffective(userDataDir, configRoot)
}

let win: BrowserWindow | null = null
let running: RunHandle | null = null

/** 当前打开的课时目录被监听着，文件一变就推给 UI 重读 */
let watchedLessonId: string | null = null

/**
 * problems.json 变了就重生成 homework.md。
 *
 * homework.md 是 problems.json 的派生视图，不是第二份手工维护的内容——
 * 否则老师删掉一道题之后，手上那张要发给学生的卷子还是旧的，而且看不出来。
 * 见 tools-py/mathtools/homework.py 的说明。
 *
 * 循环防护：重生成本身会写文件、触发下一次监听。Python 侧返回 changed=false
 * 时（内容没变）不做任何事，所以最多多跑一轮就收敛。
 */
async function syncHomework(lessonId: string): Promise<void> {
  try {
    await runPyTool('homework', { lessonDir: workspace.resolve(lessonId) }, baseDir, 30_000)
  } catch {
    // 生成失败不该影响界面刷新，老师至少还能看到 problems.json
  }
}

const watcher = new LessonWatcher((_dir) => {
  if (!watchedLessonId) return
  const id = watchedLessonId
  void syncHomework(id).finally(() => {
    win?.webContents.send(IPC.lessonChanged, id)
  })
})

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'MathTeachCopilot',
    // 无边框：标题栏自己画。系统那条灰蓝色的原生标题栏和三栏工作台的观感
    // 完全不搭，而且白白占掉 30 多像素——这个界面的纵向空间是稀缺的。
    frame: false,
    // 无边框窗口在 Windows 上仍然靠 WS_THICKFRAME 支持拖边缘缩放，
    // thickFrame 默认就是 true，别关掉——关掉之后窗口就调不了大小了。
    thickFrame: true,
    // 加载完成前先铺上底色，否则会闪一下白屏。无边框时这一下尤其显眼，
    // 因为连原生标题栏都没有，整个窗口就是一块白。
    backgroundColor: '#fbfbfc',
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.on('ready-to-show', () => win?.show())

  // 双击标题栏、Win+↑、拖到屏幕顶端都会改变最大化状态，这些路径渲染层
  // 一个都感知不到。不推的话，那个「最大化/还原」图标会和实际状态对不上。
  const pushState = (): void => {
    win?.webContents.send(IPC.windowState, win.isMaximized())
  }
  win.on('maximize', pushState)
  win.on('unmaximize', pushState)

  // 外部链接走系统浏览器，不在应用内开新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function send(lessonId: string, e: AgentEvent): void {
  win?.webContents.send(IPC.agentEvent, lessonId, e)
}

function registerIpc(): void {
  ipcMain.handle(IPC.listLessons, () => workspace.listLessons())
  // 读课时的同时开始监听它的目录：打开哪个就盯哪个，切换时自动换目标
  ipcMain.handle(IPC.readLesson, (_e, lessonId: string) => {
    if (lessonId !== watchedLessonId) {
      watchedLessonId = lessonId
      watcher.watchDir(workspace.resolve(lessonId))
    }
    return workspace.readLesson(lessonId)
  })
  ipcMain.handle(IPC.loadCurriculum, () => loadCurriculum(curriculumDir))
  ipcMain.handle(IPC.createLesson, (_e, req: CreateLessonRequest) => workspace.ensureLesson(req))
  ipcMain.handle(IPC.readFigure, (_e, lessonId: string, ref: string) =>
    workspace.readFigure(lessonId, ref),
  )
  ipcMain.handle(
    IPC.saveAttachment,
    (_e, lessonId: string, fileName: string, dataUri: string) =>
      workspace.saveAttachment(lessonId, fileName, dataUri),
  )
  ipcMain.handle(IPC.deleteProblem, (_e, lessonId: string, problemId: string) =>
    workspace.deleteProblem(lessonId, problemId),
  )
  ipcMain.handle(IPC.updateProblem, async (_e, lessonId: string, problem: unknown) => {
    const dir = workspace.resolve(lessonId)
    // 走 Python 的同一道闸门：校验结构 + 按 check 重新验算 + 写盘
    const r = await runPyTool('update_problem', { lessonDir: dir, problem }, baseDir, 60_000)
    return r as unknown
  })
  ipcMain.handle(IPC.setLessonStatus, (_e, lessonId: string, status: LessonStatus) =>
    workspace.setStatus(lessonId, status),
  )

  ipcMain.handle(IPC.exportDocx, async (_e, req: ExportRequest): Promise<ExportResult> => {
    const lesson = await workspace.readLesson(req.lessonId).catch(() => null)
    if (!lesson) return { ok: false, error: `打不开课时 ${req.lessonId}` }

    // 让老师自己选存哪儿。默认名用课时名，他多半要直接发给学生或存进教研组共享盘。
    const suggested = `${lesson.meta.lesson}-分层作业.docx`.replace(/[\/:*?"<>|]/g, '-')
    const picked = await dialog.showSaveDialog(win!, {
      title: '导出 Word',
      defaultPath: suggested,
      filters: [{ name: 'Word 文档', extensions: ['docx'] }],
    })
    if (picked.canceled || !picked.filePath) return { ok: false, canceled: true }

    const result = await runPyTool(
      'export',
      {
        lessonDir: lesson.dir,
        outPath: picked.filePath,
        title: `${lesson.meta.lesson} · 分层作业`,
        withAnswers: req.withAnswers,
      },
      baseDir,
    )

    if (result.ok) {
      // 导出成功顺手把状态推进到「已定稿」——这个字段之前永远停在「未开始」
      await workspace.setStatus(req.lessonId, '已定稿').catch(() => undefined)
      shell.showItemInFolder(String(result.path))
    }
    return result as ExportResult
  })

  ipcMain.handle(IPC.windowMinimize, () => win?.minimize())
  ipcMain.handle(IPC.windowToggleMaximize, () => {
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle(IPC.windowClose, () => win?.close())

  ipcMain.handle(IPC.getSettings, () => effective())

  ipcMain.handle(IPC.saveSettings, (_e, s: LlmSettings) => {
    writeSettings(userDataDir, s)
    // 回写完重新解析再返回：老师填的值可能被 .env 之类的东西盖住（开发期），
    // 直接把他填的原样回显会造成「保存成功但没生效」的错觉
    return effective()
  })

  ipcMain.handle(IPC.testLlm, (_e, s: LlmSettings) => testLlm(s))

  ipcMain.handle(IPC.listImageModels, (_e, s: LlmSettings) => listImageModels(s))

  ipcMain.handle(IPC.runAgent, async (_e, req: AgentRunRequest) => {
    // 没配好就别让 SDK 去撞认证错——那个错完全指不到设置页，
    // 老师只会看到一串英文然后以为软件坏了
    const cfg = effective()
    if (!cfg.configured) {
      send(req.lessonId, {
        type: 'error',
        message: '还没设置模型接入。点右上角「设置」填好网关地址和 API Key 再试。',
      })
      return
    }
    if (running) {
      send(req.lessonId, { type: 'error', message: '上一轮还没结束，先等它跑完或点中断' })
      return
    }
    // 会话包：把「这是哪节课」「这节课考什么」直接给 Agent，别让它自己去翻
    const lesson = await workspace.readLesson(req.lessonId).catch(() => null)
    const curricula = await loadCurriculum(curriculumDir).catch(() => [])
    const knowledgePoints = (lesson?.meta.standardRefs ?? [])
      .map((id) => {
        for (const c of curricula) {
          const hit = findKnowledgePoint(c, id)
          if (hit) return hit
        }
        return null
      })
      .filter((k) => k !== null)

    // 记下这一轮提问。历史只增不删——老师会想回看「上次那句话是怎么说的」。
    const turnId = `t${Date.now().toString(36)}`
    const problemsBefore = lesson?.problems.length ?? 0
    await workspace
      .appendTurn(req.lessonId, {
        id: turnId,
        at: new Date().toISOString(),
        prompt: req.prompt,
        summary: null,
        ok: null,
        problemsBefore,
        problemsAfter: null,
      })
      .catch(() => undefined)

    let lastSummary = ''
    let lastOk: boolean | null = null

    const handle = runAgent({
      lessonDir: workspace.resolve(req.lessonId),
      skillId: req.skill,
      prompt: req.prompt,
      baseDir,
      configRoot,
      // 显式传：设置界面是老师最近一次的明确选择，优先于 .env 和进程环境
      modelConfig: cfg.settings,
      curriculumDir,
      lesson: lesson
        ? {
            meta: lesson.meta,
            problemCount: lesson.problems.length,
            knowledgePoints,
            // 哪些图已经有题在用、哪些没有。没人用的那些正是要么用起来、
            // 要么别重画的——见 agent.ts 里 figures 的注释
            figures: (() => {
              const used = new Set(lesson.problems.flatMap((p) => p.figureRefs ?? []))
              return lesson.assets.map((name) => ({
                name,
                used: used.has(`assets/${name}`),
              }))
            })(),
          }
        : undefined,
      attachments: req.attachments,
      onEvent: (e) => {
        if (e.type === 'done') {
          lastSummary = e.summary
          lastOk = e.ok
        } else if (e.type === 'error') {
          lastSummary = e.message
          lastOk = false
        }
        send(req.lessonId, e)
      },
    })
    running = handle
    try {
      await handle.done
    } finally {
      running = null
      const after = await workspace
        .readLesson(req.lessonId)
        .then((l) => l.problems.length)
        .catch(() => null)
      await workspace
        .completeTurn(req.lessonId, turnId, {
          summary: lastSummary,
          ok: lastOk,
          problemsAfter: after,
        })
        .catch(() => undefined)
      // 状态推进到「备课中」：这个字段之前只有导出时才动
      if (after !== null && after > problemsBefore) {
        await workspace.setStatus(req.lessonId, '备课中').catch(() => undefined)
      }
    }
  })

  ipcMain.handle(IPC.interruptAgent, async () => {
    await running?.interrupt()
  })
}

void app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  watcher.stop()
  if (process.platform !== 'darwin') app.quit()
})
