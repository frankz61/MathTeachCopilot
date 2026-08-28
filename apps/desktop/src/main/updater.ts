/**
 * 应用内自动更新。
 *
 * 更新源是 GitHub Releases：CI 打 tag 时 electron-builder 把安装包、
 * blockmap（差量更新用）和 latest.yml 一起发布上去，electron-updater
 * 拿 latest.yml 对版本、按 blockmap 只下变过的块。安装包近 1 GB，
 * 差量下载是「等得动」和「等不动」的差别。
 *
 * 行为是刻意的「静默查、后台下、不强制装」：
 *
 * - 启动 5 秒后自动查一次并后台下载——老师不点任何按钮也能升上。
 * - 下载完不弹窗、不重启，顶栏出一个「重启安装新版本」；他不点，
 *   下次正常退出时也会装上（autoInstallOnAppQuit）。老师可能正开着卷子，
 *   应用自己消失是不可接受的。
 *
 * 已知限制：学校网络访问 GitHub 不稳定，更新可能失败。失败只报在设置窗里，
 * 不打扰主流程——出题不依赖更新。国内分发的目标形态是中继/校内代理，
 * 到时候换 feed 就行（见 relay/README.md）。
 */
import { app } from 'electron'
// 默认导入，不能写成 `import { autoUpdater } from 'electron-updater'`。
//
// electron-updater 是 CommonJS，而主进程编译出来是 ESM。它的 autoUpdater 还不是
// 普通导出，是个惰性 getter（第一次访问才按平台 new 出 NsisUpdater），Node 的
// cjs-module-lexer 静态扫不出来，于是具名导入在**运行时**炸：
//
//   SyntaxError: Named export 'autoUpdater' not found
//
// 类型检查、构建、打包全都不报——只有真把应用启动起来才炸，而且是启动即崩。
// 这条已经发出去过一次（v0.1.0），所以 CI 里加了「启动一次真应用」那道闸。
import electronUpdater from 'electron-updater'
import type { UpdateState } from '@mtc/shared'

export interface Updater {
  /** 立即查一次。结果异步经 onState 推，返回值只是发起时的状态 */
  check: () => Promise<UpdateState>
  /** 当前状态。渲染层加载完成时补发一次用——启动自动查可能早于它就绪 */
  current: () => UpdateState
  /** 退出并静默安装，装完自动重启 */
  install: () => void
}

export function initUpdater(onState: (s: UpdateState) => void): Updater {
  const currentVersion = app.getVersion()

  // 开发模式直接短路：app-update.yml 只在安装包里存在，
  // 开发期跑 checkForUpdates 只会得到一个误导性的报错。
  if (!app.isPackaged) {
    const dev: UpdateState = { status: 'dev' }
    onState(dev)
    return {
      check: async () => dev,
      current: () => dev,
      install: () => undefined,
    }
  }

  // 放在开发短路之后再取：这个 getter 一访问就 new 出一个 NsisUpdater，
  // 开发模式下没必要构造它
  const { autoUpdater } = electronUpdater

  let last: UpdateState = { status: 'idle', currentVersion }
  // download-progress 事件里不带版本号，从 update-available 记下来备用
  let pendingVersion = ''

  const emit = (s: UpdateState): void => {
    last = s
    onState(s)
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    emit({ status: 'checking', currentVersion })
  })
  autoUpdater.on('update-available', (info) => {
    pendingVersion = info.version
    emit({ status: 'available', currentVersion, newVersion: info.version })
  })
  autoUpdater.on('update-not-available', () => {
    emit({ status: 'not-available', currentVersion })
  })
  autoUpdater.on('download-progress', (p) => {
    // available 那一帧可能被直接跳过（下载起得快），版本号用记下的那份
    emit({
      status: 'downloading',
      currentVersion,
      newVersion: pendingVersion || '新版本',
      percent: p.percent,
      transferredBytes: p.transferred,
      totalBytes: p.total,
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    emit({ status: 'ready', currentVersion, newVersion: info.version })
  })
  autoUpdater.on('error', (err) => {
    // 查不到/下不动都落到这里。常见的是网络到不了 GitHub，
    // 报原文比翻成中文更有用——报给我们的日志时能对上。
    emit({
      status: 'error',
      currentVersion,
      message: err instanceof Error ? err.message : String(err),
    })
  })

  // 启动自动查：延迟几秒，别和窗口加载、教材树读取抢启动时间。
  // 这里的 .catch 只是兜底——错误同样会走上面的 error 事件推给界面。
  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => undefined), 5_000)

  return {
    check: async () => {
      await autoUpdater.checkForUpdates().catch((err: unknown) => {
        emit({
          status: 'error',
          currentVersion,
          message: err instanceof Error ? err.message : String(err),
        })
      })
      return last
    },
    current: () => last,
    install: () => {
      // 静默装、装完自动重启——按钮上写的就是「重启安装」，行为要和字面一致
      autoUpdater.quitAndInstall(true, true)
    },
  }
}
