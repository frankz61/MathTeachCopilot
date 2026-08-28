/**
 * 把应用真启动一次，确认它没有启动即崩。
 *
 *   pnpm check:app                                                      验构建产物 out/
 *   pnpm check:app apps/desktop/dist/win-unpacked/MathTeachCopilot.exe  验打包产物
 *
 * ## 为什么需要单独有这一步
 *
 * v0.1.0 发出去过一个启动即崩的包：updater.ts 用具名导入引了 CommonJS 的
 * electron-updater，而主进程编译出来是 ESM——
 *
 *   SyntaxError: Named export 'autoUpdater' not found
 *
 * 类型检查过、构建过、打包过、`pnpm check`（工具链）也过，因为那些验的全是
 * **构建期**的事。这个错只在主进程模块图真正被加载时才发生，而在那之前
 * 没有任何一步启动过应用。老师看到的是一个弹错误框、点完就没了的图标。
 *
 * ## 判定为什么走 MTC_SMOKE 而不是看输出
 *
 * 第一版想的是「起来，看 stderr 有没有致命报错」。它把已知有毒的包判成了健康：
 * **Windows 上打包出来的是 GUI 子系统程序，往管道里一个字都不写**。启动即崩时
 * 它只是弹个错误框在桌面上等着——stderr 空的、进程还活着，从外面看和正常运行
 * 一模一样。数子进程也不行：崩了的有 2 个（主进程 + crashpad），正常的有几个
 * 取决于 Chromium 的进程拓扑和 runner 有没有 GPU，把发版闸押在那上面太脆。
 *
 * 所以让应用自己报：MTC_SMOKE=1 时它初始化完就 app.exit(0)（见 src/main/index.ts）。
 * 判定变成一句话——**没在超时内以 0 退出，就是没起来**。
 *
 * 证明：主进程模块图能加载、IPC 注册完成、窗口建出来了、updater 初始化没抛。
 * 不证明：界面可用、功能正常——那要人去点，或者以后上 e2e。
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(desktopDir, '../..')

/**
 * 相对路径按**命令敲下去的那个目录**解析（pnpm 放在 INIT_CWD 里），不能按 cwd：
 * pnpm 会把脚本的 cwd 切到 apps/desktop，直接 resolve 会拼出多一层。
 * 和 check-toolchain.ts 同一个坑，那次的表现是「验打包产物」其实验的是源码。
 */
const invokedFrom = process.env['INIT_CWD'] ?? process.cwd()

/** 不传就用 electron 跑仓库里构建好的 out/；传了就跑那个 exe（打包产物） */
const target = process.argv[2] ? path.resolve(invokedFrom, process.argv[2]) : null
/** 等多久算它没起来。冒烟模式下正常是一两秒内退出，启动要读教材树，给宽一点 */
const WAIT_MS = Number(process.env['MTC_CHECK_APP_WAIT'] ?? 60_000)

function fail(msg: string): never {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}

async function main(): Promise<void> {
  let command: string
  let args: string[]

  if (target) {
    if (!existsSync(target)) fail(`找不到 ${target}`)
    command = target
    args = []
    console.log(`启动打包产物：${target}`)
  } else {
    // 开发形态：用 devDependency 里的 electron 跑 apps/desktop 的 out/。
    // 和打包产物比 externals 的解析路径不同——两种都值得验，但这条快得多，
    // 而且它是控制台程序，崩了能直接看到报错原文。
    // 二进制路径问 electron 包自己要，不手写 node_modules/electron/dist/electron.exe。
    //
    // 两个原因，第二个是被 CI 教的：
    // 1. pnpm 的软链布局、各平台的可执行文件名，都由它自己算。
    // 2. 它的入口（index.js 的 getElectronPath）**发现 dist 里没有可执行文件就会
    //    自己 spawn install.js 把二进制下下来**。runner 上 electron 的 postinstall
    //    没留下 dist/，硬写路径的版本只能报「找不到」，问它要就当场自愈了。
    //
    // 也不走 .bin/electron.cmd —— Node 从 18.20 起拒绝直接 spawn .cmd（EINVAL），
    // 开 shell:true 又会多一层 cmd.exe，退出码和 kill 全走样，而这个脚本整个判定
    // 就靠退出码。
    const req = createRequire(import.meta.url)
    try {
      command = req('electron') as unknown as string
    } catch (e) {
      fail(`解析不到 electron 包：${e instanceof Error ? e.message : String(e)}`)
    }
    if (!existsSync(command)) {
      // CI 上没法进去翻，把包目录里到底有什么打出来
      const pkgDir = path.resolve(path.dirname(command), '..')
      console.error(`electron 包目录：${pkgDir}`)
      if (existsSync(pkgDir)) console.error(`  内容：${readdirSync(pkgDir).join(' ')}`)
      const distDir = path.join(pkgDir, 'dist')
      console.error(
        existsSync(distDir)
          ? `  dist/：${readdirSync(distDir).slice(0, 12).join(' ')}`
          : '  dist/ 不存在——electron 的 postinstall（下二进制那一步）没跑成',
      )
      fail(`electron 二进制不在 ${command}`)
    }
    args = ['.']
    if (!existsSync(path.join(desktopDir, 'out', 'main', 'index.js'))) {
      fail('out/main/index.js 不在，先跑 pnpm build')
    }
    console.log(`启动构建产物：${command} .`)
  }

  const child = spawn(command, args, {
    cwd: desktopDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    // 应用看到这个就在初始化完成后立刻 app.exit(0)
    env: { ...process.env, MTC_SMOKE: '1' },
  })

  let output = ''
  child.stdout.on('data', (d: Buffer) => (output += d.toString()))
  child.stderr.on('data', (d: Buffer) => (output += d.toString()))

  const exited = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), WAIT_MS)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      fail(`拉不起来：${e.message}`)
    })
  })

  const trimmed = output.trim()
  // 打包产物这边的输出不可靠：正常跑时能看到几行 GPU 噪音，而**崩在加载阶段时
  // 一个字都没有**（v0.1.0 实测）——判定不能靠它，只能靠退出码
  if (trimmed) console.log(`\n--- 应用输出 ---\n${trimmed}\n----------------`)

  if (exited === null) {
    child.kill()
    fail(
      `${WAIT_MS / 1000} 秒内没有以 0 退出——冒烟模式下它初始化完就该自己退。\n` +
        '  多半是启动即崩，弹了个错误框在那儿等（Windows GUI 程序不往管道写东西，\n' +
        `  所以这里看不到原文）。手工双击跑一次就能看到：\n  ${command}`,
    )
  }
  if (exited !== 0) fail(`退出码 ${exited}，不是 0`)

  console.log('\n✓ 应用起来了：模块图加载、IPC 注册、窗口创建、updater 初始化都过了。')
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
