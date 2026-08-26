/**
 * 「感觉有点慢」的排查工具。
 *
 * 总时长本身说明不了问题。一轮生成的耗时其实是：
 *
 *     总时长 ≈ 每次请求的固定开销 × 来回轮数 + 真正的生成时间
 *
 * 这三项的责任人完全不同——固定开销归网关，轮数归我们的提示词和工具设计，
 * 生成时间才归模型。不拆开就只能瞎猜「是不是模型不行」，然后换个模型继续慢。
 *
 * 跑法：
 *   pnpm check:speed
 */
import { mkdtempSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runAgent } from '../src/main/agent.js'
import { resolveModelConfig } from '../src/main/config.js'
import { loadCurriculum } from '@mtc/workspace'
import { findKnowledgePoint, type KnowledgePoint, type LessonMeta, type RunStats } from '@mtc/shared'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')

/** 单发一次最小请求，量网关的固定开销——这部分和模型能力无关 */
async function probeFloor(baseUrl: string, apiKey: string, model: string): Promise<number[]> {
  const out: number[] = []
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now()
    try {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 8,
          messages: [{ role: 'user', content: '回答一个字：好' }],
        }),
      })
      await res.text()
      if (res.ok) out.push(Date.now() - t0)
    } catch {
      /* 网关不通，下面会体现为样本不足 */
    }
  }
  return out
}

async function main(): Promise<void> {
  const cfg = resolveModelConfig(repoRoot)
  // 「是不是模型的问题」只有一个验法：同一条路径、同一句话，换个别名再跑一遍。
  //   pnpm check:speed auto/claude-sonnet
  const model = process.argv[2] ?? cfg.model ?? 'claude-opus-5'
  if (!cfg.apiKey) {
    console.error('缺少 ANTHROPIC_API_KEY，把它写进仓库根的 .env')
    process.exit(1)
  }
  console.log(`模型：${model}  经由 ${cfg.baseUrl ?? '官方 API'}\n`)

  let floor = 0
  if (cfg.baseUrl) {
    console.log('[1/2] 量网关固定开销：连发 3 次最小请求（8 个输出 token）')
    const samples = await probeFloor(cfg.baseUrl, cfg.apiKey, model)
    if (samples.length > 0) {
      floor = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
      console.log(`      ${samples.map((s) => `${s}ms`).join('  ')}   → 平均 ${floor}ms`)
      console.log(
        floor > 2000
          ? `      ⚠ 这 ${(floor / 1000).toFixed(1)} 秒和生成内容无关，是每次请求都要付的入场费\n`
          : '      固定开销正常\n',
      )
    } else {
      console.log('      三次都失败，网关可能不通\n')
    }
  }

  const lessonDir = mkdtempSync(path.join(tmpdir(), 'mtc-speed-'))
  const meta: LessonMeta = {
      id: 'speed',
      textbook: '人教版',
      grade: '九年级上册',
      chapter: '第二十一章 一元二次方程',
      lesson: '21.2.2 公式法（测速临时课时）',
      standardRefs: ['rj-tp-21-03'],
      periods: 1,
      status: '备课中',
      updatedAt: new Date().toISOString(),
  }
  await writeFile(path.join(lessonDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')

  // 会话包必须和主进程构造的一模一样，否则测的就不是老师真正会走的那条路。
  // 第一版漏了它，Agent 只好自己去 lookup_curriculum 找上下文，轮数被凭空推高，
  // 于是「慢」的账被记到了模型头上——而真凶是测试本身不公平。
  const curriculumDir = path.join(repoRoot, 'curriculum')
  const curricula = await loadCurriculum(curriculumDir).catch(() => [])
  const knowledgePoints = meta.standardRefs
    .map((id) => {
      for (const c of curricula) {
        const hit = findKnowledgePoint(c, id)
        if (hit) return hit
      }
      return null
    })
    .filter((k): k is KnowledgePoint => k !== null)
  console.log(
    `      会话包：${knowledgePoints.length} 个知识点` +
      (knowledgePoints.length === 0 ? '（查不到，Agent 得自己翻，轮数会偏高）' : ''),
  )

  console.log('[2/2] 跑一轮真实生成：出 3 道 A 层的题')
  let stats: RunStats | undefined
  let firstEventAt: number | null = null
  const t0 = Date.now()
  const marks: string[] = []

  const handle = runAgent({
    lessonDir,
    skillId: 'problems',
    baseDir: repoRoot,
    configRoot: repoRoot,
    modelConfig: { ...cfg, model },
    curriculumDir,
    lesson: { meta, problemCount: 0, knowledgePoints },
    prompt: '出 3 道一元二次方程的 A 层基础题，要求整数解，验算后写进 problems.json。',
    onEvent: (e) => {
      const at = Date.now() - t0
      if (firstEventAt === null && e.type !== 'init') firstEventAt = at
      if (e.type === 'tool') marks.push(`      ${String(at).padStart(6)}ms  调用 ${e.name.split('__').pop()}`)
      if (e.type === 'init') marks.push(`      ${String(at).padStart(6)}ms  工具就绪`)
      if (e.type === 'done') stats = e.stats
      if (e.type === 'error') marks.push(`      ${String(at).padStart(6)}ms  错误：${e.message.slice(0, 80)}`)
    },
  })
  await handle.done
  const wall = Date.now() - t0
  console.log(marks.join('\n'))

  console.log('\n—— 账单 ——')
  console.log(`  端到端            ${(wall / 1000).toFixed(1)} 秒`)
  if (firstEventAt !== null) {
    console.log(`  首个动作          ${(firstEventAt / 1000).toFixed(1)} 秒（老师在此之前只能干等）`)
  }
  if (!stats) {
    console.log('  没收到 result 消息，拿不到分项账单')
    return
  }
  const s: RunStats = stats
  console.log(`  其中等模型        ${((s.apiMs ?? 0) / 1000).toFixed(1)} 秒`)
  console.log(`  来回轮数          ${s.turns ?? '?'} 轮`)
  if (s.turns) {
    console.log(
      `  平均每轮          ${(wall / s.turns / 1000).toFixed(0)} 秒` +
        `（其中网关约 ${(floor / 1000).toFixed(1)} 秒，剩下的是模型在想）`,
    )
  }
  console.log(`  token             入 ${s.inputTokens ?? '?'} / 出 ${s.outputTokens ?? '?'}`)
  console.log(`  命中提示词缓存    ${s.cacheReadTokens ?? 0}`)

  console.log('\n—— 诊断 ——')
  const turns = s.turns ?? 0
  if (floor > 2000 && turns > 0) {
    const overhead = floor * turns
    console.log(
      `  网关固定开销 ${floor}ms × ${turns} 轮 ≈ ${(overhead / 1000).toFixed(0)} 秒，` +
        `占端到端的 ${Math.round((overhead / wall) * 100)}%。`,
    )
    console.log('  这部分换模型是解决不了的——要么换更快的网关/直连，要么减少轮数。')
  }
  if (!s.cacheReadTokens) {
    console.log(
      `  提示词缓存命中 0：每一轮都在重发整套系统提示和工具定义（本轮入 ${s.inputTokens ?? '?'} token）。`,
    )
    console.log('  中转网关通常不透传 cache_control，这会同时放大延迟和费用。')
  }
  if (turns >= 6) {
    console.log(`  ${turns} 轮偏多。轮数是固定开销的乘数，值得看看能不能合并工具调用。`)
  }
  // 慢是一回事，跑了半天一道题都没写是另一回事——不核对就会把后者误读成前者
  let produced = 0
  try {
    const raw = await readFile(path.join(lessonDir, 'problems.json'), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    produced = Array.isArray(parsed) ? parsed.length : 0
  } catch {
    produced = 0
  }
  console.log(
    produced > 0
      ? `  产出 ${produced} 道题，平均 ${(wall / 1000 / produced).toFixed(0)} 秒一道`
      : '  ✗ 产出 0 道题。这不是「慢」，是这一轮白跑了——当前模型撑不住这套工具流程',
  )

  console.log(`\n工作目录留着了，可以去看产物：${lessonDir}`)
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
