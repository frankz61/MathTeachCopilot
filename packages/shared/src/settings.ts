/**
 * 模型接入设置。
 *
 * 打包成客户端之后 `.env` 就不存在了，老师也不会去编辑环境变量——
 * 必须有个界面能填。设置落在 Electron 的 userData 目录，不落在课时工作区：
 * 工作区是老师的**内容**，会被拷给同事、放到网盘上，密钥不能混在里面。
 */

export interface LlmSettings {
  /**
   * 网关或上游地址，**不要带 /v1** —— SDK 自己会拼 /v1/messages。
   * 留空则走 Anthropic 官方 API。
   */
  baseUrl: string
  apiKey: string
  /** 网关上的模型名或别名 */
  model: string
  /**
   * 生图模型的名字或别名，`render_illustration` 用它出情境插图。
   *
   * **和 model 是两套名字**：文本模型走 `/v1/messages`，图模型走
   * `/v1/images/generations`，把 model 那个别名填到这儿只会 400。
   * 所以不能合并成一项，也不该默认跟着 model 走。
   *
   * 留空用默认值。见 architecture.md §4.20。
   */
  imageModel: string
}

/**
 * 网关上有哪些图模型。
 *
 * 单独有这个是因为图模型名没法猜：老师不可能知道要填 `codex/gpt-5.6-luna`，
 * 而填错的唯一症状是四十秒后一个 400——那时候他已经在等出图了，
 * 报出来的错还完全指不到设置页。列一次是免费的（GET，不出图），
 * 所以让他从列表里点，而不是靠背。
 */
export interface ImageModelList {
  ok: boolean
  /** 网关声明 type=image 的模型 id */
  models?: string[]
  /** 失败原因；成功时是一句话说明 */
  detail?: string
}

/**
 * 这一项是从哪儿读到的。
 *
 * 设置界面必须把它显示出来。不显示就会重演一个查不动的困惑：
 * 「我明明改了 .env，怎么没生效？」——见 apps/desktop/src/main/config.ts 的注释，
 * 优先级本身反直觉，唯一的解法是让它可见。
 */
export type SettingsSource = 'settings' | 'dotenv' | 'env' | 'default' | 'none'

export interface EffectiveSettings {
  /** 当前真正生效的值 */
  settings: LlmSettings
  /** 逐项说明来源 */
  source: Record<keyof LlmSettings, SettingsSource>
  /**
   * 够不够开始用。
   *
   * 只要求 apiKey：baseUrl 留空是合法的（走官方 API），model 有默认值。
   * 把 baseUrl 也算成必填会让「我就想用官方 API」的人卡在设置页上。
   */
  configured: boolean
  /** 设置文件在哪，界面上显示给老师，出问题时他能直接去看 */
  filePath: string
}

export interface LlmTestResult {
  ok: boolean
  /** 端到端往返毫秒数。网关的固定开销在这里一眼可见（见 architecture.md §4.15） */
  ms?: number
  /** 成功时是模型回的内容摘要，失败时是原因 */
  detail?: string
}

/**
 * 填写检查。返回的是**警告**，不阻止保存——
 * 网关五花八门，我们的判断不该硬过老师的实际情况。
 */
export function settingsWarnings(s: LlmSettings): string[] {
  const out: string[] = []
  const url = s.baseUrl.trim()
  if (url) {
    if (!/^https?:\/\//i.test(url)) {
      out.push('地址要以 http:// 或 https:// 开头')
    }
    // 带上 /v1 之后 SDK 会请求 /v1/v1/messages。宽松的网关会容忍（实测本项目
    // 用的这个就通了），严格的直接 404——两种都不该赌，所以照样提醒
    if (/\/v1\/?$/.test(url)) {
      out.push('地址末尾不要带 /v1，SDK 会自己拼 /v1/messages')
    }
    if (/\/$/.test(url)) {
      out.push('地址末尾不要带斜杠')
    }
  }
  if (!s.apiKey.trim()) {
    out.push('没填 API Key，模型调用会失败')
  }
  if (!s.model.trim()) {
    out.push('没填模型名，会用默认值 claude-opus-5')
  }
  // imageModel 不校验「填没填」：留空有默认值，而且大多数课根本用不到插图。
  // 但填成文本模型的名字是**确定错的**——图接口上不存在那个别名，
  // 症状是四十秒后一个 400，值得当场提醒。
  if (s.imageModel.trim() && s.imageModel.trim() === s.model.trim()) {
    out.push('图模型和文本模型填成了同一个名字，图接口上多半没有这个别名')
  }
  return out
}
