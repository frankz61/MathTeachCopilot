/**
 * 模型接入设置的读写。
 *
 * 刻意不 import electron —— userData 路径由 index.ts 传进来，这样这一层能单测，
 * 和 agent.ts 同一个理由。
 *
 * ## 为什么不落在工作区里
 *
 * 设置存 `userData/settings.json`，不存 `~/MathTeachCopilot/`。
 * 工作区是老师的**内容**：他会整个拷给同事、放到网盘上、拖进 U 盘。
 * 密钥混在里面等于跟着课件到处跑。
 *
 * ## 关于把密钥放在教师机器上
 *
 * docs/architecture.md 第 8.3 节的目标形态是中继：客户端只拿一个我们发的短期凭据，
 * 上游厂商密钥永远不落到教师机器。那个还没做，现在这个界面是过渡形态——
 * 它至少让「密钥在哪、是谁填的、能不能换」变成显式的、可见的。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type {
  EffectiveSettings,
  ImageModelList,
  LlmSettings,
  LlmTestResult,
  SettingsSource,
} from '@mtc/shared'
import { loadDotEnv } from './config.js'

/** 模型名没填时用它。和 agent.ts 里的兜底保持一致。 */
export const DEFAULT_MODEL = 'claude-opus-5'

/**
 * 图模型没填时用它。
 *
 * illustration.py 里有同样一个默认值，看着像重复，但两边都需要：
 * Python 那份服务「脱离客户端直接跑工具」（测试、cli），这份服务界面——
 * 界面必须**显示**出实际会用哪个，否则老师看到一个空框，
 * 没法判断插图是用什么画的。两边不一致时以这份为准，因为它会显式转发过去。
 */
export const DEFAULT_IMAGE_MODEL = 'codex/gpt-5.6-luna'

/** baseUrl 留空时打到哪 */
const OFFICIAL_API = 'https://api.anthropic.com'

const EMPTY: LlmSettings = { baseUrl: '', apiKey: '', model: '', imageModel: '' }

export function settingsFile(userDataDir: string): string {
  return path.join(userDataDir, 'settings.json')
}

function readFile(userDataDir: string): Partial<LlmSettings> {
  const file = settingsFile(userDataDir)
  if (!existsSync(file)) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf-8'))
    if (!parsed || typeof parsed !== 'object') return {}
    const o = parsed as Record<string, unknown>
    const pick = (k: string): string | undefined =>
      typeof o[k] === 'string' ? (o[k] as string) : undefined
    return {
      baseUrl: pick('baseUrl'),
      apiKey: pick('apiKey'),
      model: pick('model'),
      imageModel: pick('imageModel'),
    }
  } catch {
    // 文件坏了不要崩，也不要静默当成空——当成空会让老师以为设置丢了，
    // 而实际上文件还在那儿。这里回空，界面上会显示来源是 none，他重填即可。
    return {}
  }
}

export function writeSettings(userDataDir: string, s: LlmSettings): void {
  mkdirSync(userDataDir, { recursive: true })
  const file = settingsFile(userDataDir)
  const body: LlmSettings = {
    baseUrl: s.baseUrl.trim().replace(/\/+$/, ''),
    apiKey: s.apiKey.trim(),
    model: s.model.trim(),
    imageModel: s.imageModel.trim(),
  }
  writeFileSync(file, JSON.stringify(body, null, 2), 'utf-8')
}

/**
 * 解析出当前真正生效的配置，并说明每一项来自哪里。
 *
 * 优先级：**设置界面 > .env > 进程环境 > 默认值**。
 *
 * 设置界面排第一是因为它是老师最近一次的**显式**动作。
 * .env 排第二只服务开发期（打包后根本没有这个文件）。
 * 进程环境排最后，而且 config.ts 里已经写明了理由：宿主机上常常带着
 * ANTHROPIC_* 变量，让它们悄悄盖掉项目配置会造出极难定位的认证错。
 *
 * 逐项返回来源，是为了让「我改了 X 怎么没生效」当场可见，不用去猜优先级。
 */
export function resolveEffective(userDataDir: string, repoRoot: string): EffectiveSettings {
  const file = readFile(userDataDir)
  const dotenv = loadDotEnv(repoRoot)

  const pick = (
    fileKey: keyof LlmSettings,
    envKey: string,
    fallback = '',
  ): [string, SettingsSource] => {
    const fromFile = file[fileKey]
    if (fromFile !== undefined && fromFile !== '') return [fromFile, 'settings']
    const fromDotEnv = dotenv[envKey]
    if (fromDotEnv) return [fromDotEnv, 'dotenv']
    const fromEnv = process.env[envKey]
    if (fromEnv) return [fromEnv, 'env']
    return [fallback, fallback ? 'default' : 'none']
  }

  const [baseUrl, baseUrlFrom] = pick('baseUrl', 'ANTHROPIC_BASE_URL')
  const [apiKey, apiKeyFrom] = pick('apiKey', 'ANTHROPIC_API_KEY')
  const [model, modelFrom] = pick('model', 'MTC_MODEL', DEFAULT_MODEL)
  const [imageModel, imageModelFrom] = pick('imageModel', 'MTC_IMAGE_MODEL', DEFAULT_IMAGE_MODEL)

  return {
    settings: { baseUrl, apiKey, model, imageModel },
    source: {
      baseUrl: baseUrlFrom,
      apiKey: apiKeyFrom,
      model: modelFrom,
      imageModel: imageModelFrom,
    },
    // 只要求 apiKey：baseUrl 留空走官方 API 是合法的，model 有默认值
    configured: apiKey.trim().length > 0,
    filePath: settingsFile(userDataDir),
  }
}

/**
 * 真的发一次最小请求。
 *
 * 「填对了吗」没有别的验法。地址少一段、别名在网关上不存在、密钥过期，
 * 三种都只在真正出题时才暴露——那时候老师已经等了几分钟，
 * 而且报出来的错完全指不到设置页。
 *
 * 顺便把往返毫秒数报出来：这个网关实测有 1.2~10.6 秒的每请求固定开销
 * （见 architecture.md §4.15），老师看到 8 秒就知道后面出一组题会慢，
 * 不会以为是软件卡住了。
 */
export async function testLlm(s: LlmSettings, timeoutMs = 30_000): Promise<LlmTestResult> {
  const base = (s.baseUrl.trim() || OFFICIAL_API).replace(/\/+$/, '')
  const model = s.model.trim() || DEFAULT_MODEL
  if (!s.apiKey.trim()) return { ok: false, detail: '没填 API Key' }

  const t0 = Date.now()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': s.apiKey.trim(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 16,
        messages: [{ role: 'user', content: '回答一个字：好' }],
      }),
      signal: ctl.signal,
    })
    const ms = Date.now() - t0
    const text = await res.text()
    if (!res.ok) {
      return { ok: false, ms, detail: `HTTP ${res.status}：${explain(res.status, text)}` }
    }
    let reply = ''
    try {
      const j: unknown = JSON.parse(text)
      const content = (j as { content?: { type: string; text?: string }[] }).content ?? []
      reply = content
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('')
        .trim()
    } catch {
      return { ok: false, ms, detail: `返回的不是合法 JSON：${text.slice(0, 160)}` }
    }
    return {
      ok: true,
      ms,
      detail: reply ? `模型回了「${reply.slice(0, 20)}」` : '连上了，但模型没回内容',
    }
  } catch (e) {
    const ms = Date.now() - t0
    if (e instanceof Error && e.name === 'AbortError') {
      return { ok: false, ms, detail: `${timeoutMs / 1000} 秒没有响应，地址可能不对或网络不通` }
    }
    return { ok: false, ms, detail: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 问网关有哪些图模型。
 *
 * 图模型名没法猜（`codex/gpt-5.6-luna` 这种带斜杠的别名），而填错的唯一症状是
 * **四十秒后一个 400**——那时候老师正等着插图出来，报出来的错完全指不到设置页。
 *
 * 这个查询是免费的：GET 一次，不出图。所以让他从列表里点一个，而不是靠背。
 *
 * 和 testLlm 是两条路：那个打的是 /v1/messages（文本），这个打的是
 * /v1/images/generations（图）。网关上这两套模型名不通用，一个能用不代表另一个能用。
 */
export async function listImageModels(
  s: LlmSettings,
  timeoutMs = 20_000,
): Promise<ImageModelList> {
  const base = s.baseUrl.trim().replace(/\/+$/, '')
  if (!s.apiKey.trim()) return { ok: false, detail: '没填 API Key' }
  if (!base) {
    return {
      ok: false,
      detail: 'Anthropic 官方 API 没有生图接口。情境插图需要一个提供图模型的网关。',
    }
  }

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    // GET 这个路径返回的是**图模型清单**，不是出图。出图是同一个路径的 POST。
    const res = await fetch(`${base}/v1/images/generations`, {
      headers: { authorization: `Bearer ${s.apiKey.trim()}` },
      signal: ctl.signal,
    })
    const text = await res.text()
    if (res.status === 404) {
      // explain() 的 404 说的是「地址末尾别带 /v1」，那是文本接口的坑；
      // 这里 404 的实际含义是这个网关根本没有图接口，别把老师往错方向指
      return { ok: false, detail: '这个网关没有生图接口（/v1/images/generations 不存在）' }
    }
    if (!res.ok) {
      return { ok: false, detail: `HTTP ${res.status}：${explain(res.status, text)}` }
    }

    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      return { ok: false, detail: `返回的不是合法 JSON：${text.slice(0, 160)}` }
    }

    const items = (data as { data?: { id?: unknown; type?: unknown }[] }).data ?? []
    const models = items
      .filter((m) => typeof m.id === 'string' && (m.type === undefined || m.type === 'image'))
      .map((m) => m.id as string)

    if (models.length === 0) {
      return { ok: false, detail: '这个网关上没有图模型，插图功能用不了' }
    }
    return { ok: true, models, detail: `网关上有 ${models.length} 个图模型` }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return { ok: false, detail: `${timeoutMs / 1000} 秒没有响应，地址可能不对或网络不通` }
    }
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
  }
}

/** 把 HTTP 状态翻成老师能照着改的话，而不是丢一串英文给他 */
function explain(status: number, body: string): string {
  const short = body.replace(/\s+/g, ' ').slice(0, 200)
  if (status === 401 || status === 403) return `密钥被拒。检查 API Key 是否填错或已过期。${short}`
  if (status === 404) {
    return (
      `地址或模型名不对。注意地址末尾不要带 /v1（SDK 会自己拼 /v1/messages）。${short}`
    )
  }
  if (status === 400) return `请求被拒，多半是模型名在网关上不存在。${short}`
  if (status === 429) return `被限流了，稍后再试。${short}`
  if (status >= 500) return `网关自己出错了，不是你的设置问题。${short}`
  return short
}
