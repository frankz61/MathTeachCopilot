/**
 * 模型接入配置。
 *
 * 优先级刻意是：**.env 高于进程环境**。
 *
 * 反直觉，但踩过才知道必要：宿主环境常常已经带着 ANTHROPIC_BASE_URL 之类的变量
 * （在 Claude Code 里开发本项目时就是如此），而 node --env-file 不覆盖已存在的
 * 变量，结果是项目配置被静默忽略，表现为「认证走错通道」这种极难定位的错。
 *
 * 打包后这里应改成读应用自己的设置文件；.env 只服务开发期。
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export interface ModelConfig {
  /** 中继或上游的地址，不带 /v1 —— SDK 自己会拼 /v1/messages */
  baseUrl?: string
  apiKey?: string
  model?: string
  /**
   * 生图模型的别名，给 render_illustration 用。
   *
   * 和 model 分开是因为网关上这是两套名字：文本走 mathcopilot 这种别名，
   * 图模型是 codex/gpt-5.6-luna 之类，拿 model 的值去打图接口只会 400。
   * 没配就用 Python 侧的默认值，不是必填项。
   */
  imageModel?: string
}

function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

export function loadDotEnv(repoRoot: string): Record<string, string> {
  const file = path.join(repoRoot, '.env')
  if (!existsSync(file)) return {}
  try {
    return parseDotEnv(readFileSync(file, 'utf-8'))
  } catch {
    return {}
  }
}

export function resolveModelConfig(repoRoot: string, override: ModelConfig = {}): ModelConfig {
  const file = loadDotEnv(repoRoot)
  const pick = (key: string): string | undefined =>
    file[key] ?? process.env[key] ?? undefined
  return {
    baseUrl: override.baseUrl ?? pick('ANTHROPIC_BASE_URL'),
    apiKey: override.apiKey ?? pick('ANTHROPIC_API_KEY') ?? pick('ANTHROPIC_AUTH_TOKEN'),
    model: override.model ?? pick('MTC_MODEL'),
    imageModel: override.imageModel ?? pick('MTC_IMAGE_MODEL'),
  }
}

/**
 * 交给 Claude Code 子进程的环境变量。
 *
 * 不整个继承 process.env：宿主机上可能有一整套 CLAUDE_CODE_* 会话变量
 * （尤其在 Claude Code 里跑本项目时），子进程会据此走宿主的 OAuth 通道，
 * 而不是我们指定的中继，报出来的错还完全指不到这里。
 *
 * 和 settingSources: [] 是同一个原则：这是产品，凭据和行为都必须由应用说了算。
 */
export function buildAgentEnv(config: ModelConfig): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'CLAUDECODE') continue
    if (key.startsWith('CLAUDE_CODE_')) continue
    if (key.startsWith('ANTHROPIC_')) continue // 一律由 config 显式给
    env[key] = value
  }
  if (config.baseUrl) env['ANTHROPIC_BASE_URL'] = config.baseUrl
  if (config.apiKey) env['ANTHROPIC_API_KEY'] = config.apiKey
  return env
}
