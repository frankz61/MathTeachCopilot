/**
 * 题型分布的实测。
 *
 * 老师反馈「题型不丰富」时，实测 72 道题里解答占 69%、证明 0 道。根因不在提示词，
 * 而在验算体系没有选择题这一档（见 docs/architecture.md §4.16）——**闸门会悄悄
 * 塑造产物**：一个只能给某类题发黄牌的验算体系，等于在劝模型别做那类题。
 *
 * 这条只能靠跑真实生成来验：单测能证明 choice 这一档管用，但证明不了模型愿意用它。
 *
 * 跑法（建议指定一个撑得住工具流程的别名）：
 *   pnpm check:types auto/claude-sonnet
 */
import { mkdtempSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runAgent } from '../src/main/agent.js'
import { resolveModelConfig } from '../src/main/config.js'
import { loadCurriculum } from '@mtc/workspace'
import { findKnowledgePoint, type KnowledgePoint, type LessonMeta, type Problem } from '@mtc/shared'

const repoRoot = 'E:/seven_workspace/ai_workspace/MathTeachCopilot'

async function main(): Promise<void> {
  const cfg = resolveModelConfig(repoRoot)
  const model = process.argv[2] ?? cfg.model!
  console.log(`模型：${model}\n`)

  const lessonDir = mkdtempSync(path.join(tmpdir(), 'mtc-types-'))
  const meta: LessonMeta = {
    id: 'types', textbook: '人教版', grade: '九年级上册',
    chapter: '第二十一章 一元二次方程', lesson: '21.2 解一元二次方程（题型测试）',
    standardRefs: ['rj-tp-21-03'], periods: 1, status: '备课中',
    updatedAt: new Date().toISOString(),
  }
  await writeFile(path.join(lessonDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')

  const curriculumDir = path.join(repoRoot, 'curriculum')
  const curricula = await loadCurriculum(curriculumDir).catch(() => [])
  const knowledgePoints = meta.standardRefs
    .map((id) => { for (const c of curricula) { const h = findKnowledgePoint(c, id); if (h) return h } return null })
    .filter((k): k is KnowledgePoint => k !== null)

  const t0 = Date.now()
  const handle = runAgent({
    lessonDir, skillId: 'problems', baseDir: repoRoot, configRoot: repoRoot,
    modelConfig: { ...cfg, model }, curriculumDir,
    lesson: { meta, problemCount: 0, knowledgePoints },
    prompt: '出 6 道分层作业：A 层 3 道、B 层 2 道、C 层 1 道。',
    onEvent: (e) => {
      const at = ((Date.now() - t0) / 1000).toFixed(0)
      if (e.type === 'tool') console.log(`  ${at.padStart(4)}s  ${e.name.split('__').pop()}`)
      if (e.type === 'done') console.log(`\n  ${at}s  ${e.ok ? '完成' : '失败'}：${e.summary.slice(0, 200)}`)
      if (e.type === 'error') console.log(`  ${at}s  错误：${e.message.slice(0, 160)}`)
    },
  })
  await handle.done

  const raw = await readFile(path.join(lessonDir, 'problems.json'), 'utf-8').catch(() => null)
  if (!raw) { console.log('\n✗ 一道题都没出'); return }
  const ps = JSON.parse(raw) as Problem[]
  const byType = new Map<string, number>()
  for (const p of ps) byType.set(p.type, (byType.get(p.type) ?? 0) + 1)

  console.log(`\n—— 题型分布（${ps.length} 道）——`)
  for (const [t, c] of [...byType].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t}  ${c} 道  ${'#'.repeat(c * 4)}`)
  }
  console.log('\n—— 逐题 ——')
  for (const p of ps) {
    const v = p.verify?.status ?? '未验证'
    const opts = p.options ? ` 选项${Object.keys(p.options).length}个` : ''
    const ck = p.check?.kind === 'choice' ? `choice/${p.check.basis.kind}` : (p.check?.kind ?? '-')
    console.log(`  ${p.id.padEnd(8)} ${p.tier} ${p.type}  ${v.padEnd(7)} ${ck}${opts}`)
    if (p.options) for (const [k, t] of Object.entries(p.options)) console.log(`            ${k}. ${t.slice(0, 40)}`)
  }
  console.log(`\n工作目录：${lessonDir}`)
}
main().catch((e: unknown) => { console.error(e); process.exit(1) })
