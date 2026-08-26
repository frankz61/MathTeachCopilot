/**
 * 复现「选中课时 → 输入生成三道题 → 最后没反应」。
 *
 * 走的是和 UI 完全一样的链路（runAgent + 同一套事件），但把每个事件、
 * 每个耗时、以及**是否真的收到 done** 都打出来。
 *
 *   pnpm --filter @mtc/desktop repro -- "<课时 id>" "<提示词>"
 */
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { Workspace, loadCurriculum } from '@mtc/workspace'
import { findKnowledgePoint } from '@mtc/shared'
import { runAgent } from '../src/main/agent.js'
import { resolveModelConfig } from '../src/main/config.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const workspace = new Workspace(path.join(os.homedir(), 'MathTeachCopilot'))
  const lessons = await workspace.listLessons()

  if (lessons.length === 0) {
    console.error('工作区里没有课时')
    process.exit(1)
  }

  const lessonId = args[0] || lessons[0]!.id
  const prompt = args[1] || '生成三道题目'
  const modelOverride = args[2]
  const meta = lessons.find((l) => l.id === lessonId)
  if (!meta) {
    console.error(`找不到课时 ${lessonId}。现有：`)
    for (const l of lessons) console.error('  ' + l.id)
    process.exit(1)
  }

  const cfg = resolveModelConfig(repoRoot, modelOverride ? { model: modelOverride } : {})
  console.log(`课时  : ${meta.lesson}（${meta.textbook}${meta.grade} · ${meta.chapter}）`)
  console.log(`知识点: ${meta.standardRefs.join(', ') || '(空)'}`)
  console.log(`模型  : ${cfg.model ?? 'claude-opus-5'} @ ${cfg.baseUrl ?? '官方'}`)
  console.log(`提示词: ${prompt}`)
  console.log('─'.repeat(70))

  // 和 main/index.ts 一样把知识点解析好塞进会话包，否则脚本测不到真实链路
  const curricula = await loadCurriculum(path.join(repoRoot, 'curriculum')).catch(() => [])
  const lesson = await workspace.readLesson(lessonId)
  const knowledgePoints = meta.standardRefs
    .map((id) => curricula.map((c) => findKnowledgePoint(c, id)).find((k) => k) ?? null)
    .filter((k) => k !== null)
  console.log(
    `会话包: ${knowledgePoints.length} 个知识点，` +
      `${knowledgePoints.reduce((n, k) => n + k.commonErrors.length, 0)} 条错因`,
  )

  const t0 = Date.now()
  const ms = (): string => `[${String(Date.now() - t0).padStart(6)}ms]`
  let sawDone = false
  let sawError = false

  const handle = runAgent({
    lessonDir: workspace.resolve(lessonId),
    skillId: 'problems',
    baseDir: repoRoot,
    configRoot: repoRoot,
    ...(modelOverride ? { modelConfig: { model: modelOverride } } : {}),
    curriculumDir: path.join(repoRoot, 'curriculum'),
    // figures 和知识点同理：main/index.ts 传什么这里就得传什么，否则测的不是真实链路
    lesson: {
      meta,
      problemCount: lesson.problems.length,
      knowledgePoints,
      figures: (() => {
        const used = new Set(lesson.problems.flatMap((p) => p.figureRefs ?? []))
        return lesson.assets.map((name) => ({ name, used: used.has(`assets/${name}`) }))
      })(),
    },
    prompt,
    onEvent: (e) => {
      switch (e.type) {
        case 'init': {
          console.log(`${ms()} init      ${e.mcpServers.map((s) => `${s.name}=${s.status}`).join(' ')}`)
          const mcpTools = e.tools.filter((t) => t.startsWith('mcp__'))
          console.log(`${ms()} tools     共 ${e.tools.length} 个，其中 mcp__ 有 ${mcpTools.length} 个`)
          console.log(`${ms()}           mcp: ${mcpTools.join(', ') || '(一个都没有！)'}`)
          console.log(`${ms()}           内置: ${e.tools.filter((t) => !t.startsWith('mcp__')).join(', ')}`)
          break
        }
        case 'text':
          console.log(`${ms()} text      ${e.text.replace(/\s+/g, ' ').slice(0, 90)}`)
          break
        case 'tool':
          console.log(`${ms()} tool      ${e.name}`)
          break
        case 'file':
          console.log(`${ms()} file      ${e.action} ${e.path}`)
          break
        case 'done':
          sawDone = true
          console.log(`${ms()} done      ok=${e.ok}  ${e.summary.replace(/\s+/g, ' ').slice(0, 120)}`)
          break
        case 'error':
          sawError = true
          console.log(`${ms()} ERROR     ${e.message}`)
          break
      }
    },
  })

  // UI 里是 void api().runAgent(...)，没有 catch —— 这里把它显式抓出来
  let threw: unknown = null
  try {
    await handle.done
  } catch (e) {
    threw = e
  }

  console.log('─'.repeat(70))
  console.log(`总耗时     : ${Date.now() - t0}ms`)
  console.log(`收到 done  : ${sawDone}`)
  console.log(`收到 error : ${sawError}`)
  console.log(`handle.done 抛错: ${threw ? String(threw) : '否'}`)

  if (!sawDone && !sawError) {
    console.log()
    console.log('✗ 既没有 done 也没有 error —— UI 的 busy 永远不会复位，表现就是「没反应」')
    process.exit(1)
  }

  const after = await workspace.readLesson(lessonId)
  console.log(`落盘题目   : ${after.problems.length} 道`)
  for (const p of after.problems) {
    console.log(`             [${p.verify?.status ?? '未验证'}] ${p.tier} ${p.stem.slice(0, 40)}`)
  }
}

main().catch((e: unknown) => {
  console.error('脚本本身抛错：', e)
  process.exit(1)
})
