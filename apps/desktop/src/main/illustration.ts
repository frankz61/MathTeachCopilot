/**
 * 情境插图（render_illustration）能不能用，由主进程探测，不让老师配。
 *
 * 原来设置里有一项「图模型」，还能列出网关上的全部图模型来点。网关上有一百多个，
 * 名字是 `antigravity/gemini-3.1-flash-image` 这种，老师既看不懂也不该看到。
 * 现在图模型写死一个，生成前查一下网关的图模型清单里有没有它：
 * 有就把它交给工具进程、开放插图；没有就这一轮不开放，Agent 根本看不到这个工具。
 *
 * 查清单是一次 GET（/v1/images/generations），不出图、不花钱。
 */
import type { LlmSettings } from '@mtc/shared'
import { listImageModels } from './settings.js'

/** 情境插图用的图模型。tools-py/mathtools/illustration.py 的 DEFAULT_MODEL 是同一个 */
export const IMAGE_MODEL = 'antigravity/gemini-3.1-flash-image'

export interface IllustrationSupport {
  ok: boolean
  /** 不支持时的原因，写进日志，也告诉 Agent 为什么这轮没有插图 */
  reason?: string
}

/**
 * 按「网关 + 密钥」缓存。只缓存确定的答案（清单拿到了、或者网关明确没有图接口）；
 * 网络超时这类偶发失败不缓存，下一轮再查——否则一次断网就让插图一整天都用不了。
 */
const cache = new Map<string, Promise<IllustrationSupport>>()

export function illustrationSupport(s: LlmSettings): Promise<IllustrationSupport> {
  const key = `${s.baseUrl.trim()}|${s.apiKey.trim()}`
  const hit = cache.get(key)
  if (hit) return hit

  const p = (async (): Promise<IllustrationSupport> => {
    const list = await listImageModels(s)
    if (list.ok && list.models) {
      return list.models.includes(IMAGE_MODEL)
        ? { ok: true }
        : { ok: false, reason: `网关上没有 ${IMAGE_MODEL}` }
    }
    // 拿不到清单：官方 API / 网关没有图接口 / 网络问题。前两种是确定的
    const definite = /没有生图接口|不存在|没有图模型/.test(list.detail ?? '')
    if (!definite) cache.delete(key)
    return { ok: false, reason: list.detail ?? '查不到网关的图模型清单' }
  })()
  cache.set(key, p)
  return p
}

/**
 * 提前查一次，让第一轮生成不必等它。设置保存后、应用启动时调。
 * 结果不用管，失败也不报——真正要用时 illustrationSupport 会再给出答案。
 */
export function warmIllustrationSupport(s: LlmSettings): void {
  if (s.apiKey.trim()) void illustrationSupport(s).catch(() => undefined)
}
