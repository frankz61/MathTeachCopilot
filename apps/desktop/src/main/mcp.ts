/**
 * Python 工具进程的启动配置。
 *
 * 开发期用 uv 拉起源码；打包后用 vendor/ 里随包分发的 embeddable Python。
 * 不用 PyInstaller 的理由见 docs/architecture.md 第五节。
 */
import { existsSync } from 'node:fs'
import path from 'node:path'

export interface StdioMcpServer {
  command: string
  args: string[]
  env?: Record<string, string>
  /**
   * 让本 server 的工具**始终进提示词**，不被 tool search 延迟加载。
   *
   * 不加这个会出一种很难查的故障：工具明明连上了（init 里能看到 6 个 mcp__ 工具），
   * 模型却回「当前会话里没有 save_problems 工具」然后收尾。因为默认情况下
   * MCP 工具的定义是延迟的，模型得先搜索才能看见——它没搜就断言不存在。
   *
   * 我们只有 7 个工具，全量加载的上下文开销可以忽略。
   */
  alwaysLoad?: boolean
}

/** 从 apps/desktop/src/main 往上找到仓库根 */
function repoRoot(fromDir: string): string {
  let dir = fromDir
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return fromDir
}

/**
 * 交给工具子进程的环境变量。
 *
 * MCP 客户端对「声明的 env 是否与父进程环境合并」行为不一。调试开关一旦漏传，
 * 表现是断点静默不生效、查起来很费劲，所以这里显式转发，不指望继承。
 */
function toolEnv(): Record<string, string> {
  const env: Record<string, string> = {
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  }
  // 见 .vscode/launch.json 的「Python：附加到工具进程」
  for (const key of ['MTC_DEBUGPY', 'MTC_DEBUGPY_PORT'] as const) {
    const value = process.env[key]
    if (value) env[key] = value
  }
  return env
}

/**
 * @param baseDir  打包后传 process.resourcesPath，开发期传任意源码目录
 * @param llm      生效中的模型接入配置。render_illustration 要出网调网关的图模型，
 *                 是工具层第一个需要凭据的工具——不传它就只能报「没配置」。
 */
export function mathtoolsServer(
  baseDir: string,
  curriculumDir?: string,
  llm?: { baseUrl?: string; apiKey?: string; imageModel?: string },
): StdioMcpServer {
  const env = toolEnv()
  // 教材数据不在课时目录里，Agent 只能靠 lookup_curriculum 查——
  // 这个路径不传，那个工具就是瞎的
  if (curriculumDir) env['MTC_CURRICULUM_DIR'] = curriculumDir

  // 凭据显式转发，不指望子进程继承。
  //
  // 用 MTC_IMAGE_* 而不是直接透传 ANTHROPIC_*：工具进程调的是网关的
  // OpenAI 兼容图接口（/v1/images/generations），不是 Anthropic 的
  // /v1/messages。名字对上了协议对不上，下次排查会白走一圈。
  //
  // 值来自设置界面解析出的生效配置（settings > .env > 环境），所以老师在设置里
  // 换了网关，插图工具跟着换——不会出现「问答走新网关、出图还打旧的」。
  if (llm?.baseUrl) env['MTC_IMAGE_BASE_URL'] = llm.baseUrl
  if (llm?.apiKey) env['MTC_IMAGE_KEY'] = llm.apiKey
  // 图模型别名单独一项：网关上的图模型和文本模型是两套名字，MTC_MODEL 填的那个
  // （比如 mathcopilot）在图接口上不存在。不配就用 Python 侧的默认值。
  if (llm?.imageModel) env['MTC_IMAGE_MODEL'] = llm.imageModel
  // 打包形态：vendor/python/python.exe + tools-py/server.py 都在 resources 下
  const bundledPython = path.join(baseDir, 'vendor', 'python', 'python.exe')
  const bundledServer = path.join(baseDir, 'tools-py', 'server.py')
  if (existsSync(bundledPython) && existsSync(bundledServer)) {
    return { command: bundledPython, args: [bundledServer], env, alwaysLoad: true }
  }

  // 开发形态：uv run
  const root = repoRoot(baseDir)
  return {
    command: 'uv',
    args: [
      'run',
      '--project',
      path.join(root, 'tools-py'),
      'python',
      path.join(root, 'tools-py', 'server.py'),
    ],
    env,
    alwaysLoad: true,
  }
}

/** MCP 工具在 Agent 侧的名字前缀 */
export const MATHTOOLS_PREFIX = 'mcp__mathtools__'
