/**
 * 端到端 spike。docs/architecture.md 第十节说的那条线，排在所有业务代码之前。
 *
 *   Agent 生成一道二次方程题 → 经 MCP 调 SymPy 验算 → 导出 docx
 *   → 在 Word 里打开，确认公式可编辑
 *
 * 它一次验证三件事：Agent SDK 跑得通、MCP 连得上 Python 工具进程、
 * pandoc 的 OMML 输出是真的。任何一环失败都会改架构。
 *
 * 跑法：
 *   pnpm spike
 *
 * 最后一步（公式是否可编辑）机器验不了，必须人去 Word 里点一下——
 * 点中公式能进入编辑状态才算过，是一张图片就算没过。
 */
import { mkdtempSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runAgent } from '../src/main/agent.js'
import type { Problem } from '@mtc/shared'
import { resolveModelConfig } from '../src/main/config.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')

async function main(): Promise<void> {
  const cfg = resolveModelConfig(repoRoot)
  if (!cfg.apiKey) {
    console.error('缺少 ANTHROPIC_API_KEY。把它写进仓库根的 .env，参考 .env.example')
    process.exit(1)
  }
  console.log(`模型：${cfg.model ?? 'claude-opus-5'}  经由 ${cfg.baseUrl ?? '官方 API'}`)

  const lessonDir = mkdtempSync(path.join(tmpdir(), 'mtc-spike-'))
  console.log(`工作目录：${lessonDir}\n`)

  await writeFile(
    path.join(lessonDir, 'meta.json'),
    JSON.stringify(
      {
        id: 'spike',
        textbook: '人教版',
        grade: '九年级上册',
        chapter: '第二十五章 一元二次方程',
        lesson: '25.2.2 公式法（spike 临时课时）',
        standardRefs: ['rj-tp-25-03'],
        periods: 1,
        status: '备课中',
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf-8',
  )

  let sawSave = false
  const toolsUsed: string[] = []

  const handle = runAgent({
    lessonDir,
    skillId: 'problems',
    baseDir: repoRoot,
    configRoot: repoRoot,
    prompt:
      '出 1 道一元二次方程的基础题（A 层），要求整数解。' +
      '按规则验算后写进 problems.json。只出这一道，不要多出。',
    onEvent: (e) => {
      switch (e.type) {
        case 'init':
          console.log(`[1/4] 工具就绪：${e.mcpServers.map((s) => `${s.name}=${s.status}`).join(' ')}`)
          break
        case 'tool':
          toolsUsed.push(e.name)
          if (e.name.endsWith('__save_problems')) {
            sawSave = true
            console.log('[2/4] Agent 调用了 save_problems（验算在工具内强制执行）')
          }
          break
        case 'file':
          console.log(`[3/4] 写入 ${path.basename(e.path)}`)
          break
        case 'error':
          console.error('  ! ' + e.message)
          break
        case 'done':
          console.log(`\n${e.summary}\n`)
          break
      }
    },
  })

  await handle.done

  // --- 断言：题是通过闸门落盘的 ---
  if (!sawSave) {
    fail(
      'Agent 没有调用 save_problems —— 它可能绕过闸门直接 Write 了 problems.json。\n' +
        `  这一轮用过的工具：${toolsUsed.join(', ') || '(无)'}`,
    )
  }

  const raw = await readFile(path.join(lessonDir, 'problems.json'), 'utf-8').catch(() => null)
  if (!raw) fail('problems.json 读不到')
  const problems = JSON.parse(raw!) as Problem[]
  if (problems.length === 0) fail('problems.json 是空的')

  for (const p of problems) {
    if (!p.verify) fail(`题目 ${p.id} 没有 verify 字段 —— 未验证的题不该落盘`)
    if (p.verify.status === 'red') fail(`题目 ${p.id} 是 red 却被写进了 problems.json`)
    if (p.verify.paths.length < 2) {
      fail(`题目 ${p.id} 只有 ${p.verify.paths.length} 条验算路径，双路径校验没生效`)
    }
  }
  console.log(`[3/4] ✓ ${problems.length} 道题，全部带双路径验证戳`)

  // --- 导出，直接调 Python 工具层，不经过 Agent ---
  const docx = path.join(lessonDir, 'spike.docx')
  const { spawnSync } = await import('node:child_process')
  const py = spawnSync(
    'uv',
    ['run', '--project', path.join(repoRoot, 'tools-py'), 'python', '-c',
      `import json,sys
sys.path.insert(0, r'${path.join(repoRoot, 'tools-py').replace(/\\/g, '\\\\')}')
from mathtools.export import export_docx
problems = json.loads(open(r'${path.join(lessonDir, 'problems.json').replace(/\\/g, '\\\\')}', encoding='utf-8').read())
print(json.dumps(export_docx(problems, r'${docx.replace(/\\/g, '\\\\')}'), ensure_ascii=False))`],
    { encoding: 'utf-8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
  )
  const out = (py.stdout || '').trim().split('\n').pop() ?? ''
  let result: { ok?: boolean; error?: string; path?: string }
  try {
    result = JSON.parse(out) as typeof result
  } catch {
    fail(`导出调用失败：${py.stderr || out}`)
    return
  }

  if (!result.ok) {
    console.error(`\n[4/4] ✗ 导出失败：${result.error}`)
    console.error('  —— 这一环失败就要改架构，见 docs/architecture.md 第七节的升级路径')
    process.exit(1)
  }

  console.log(`[4/4] ✓ 已导出 ${result.path}`)
  console.log('\n最后一步机器验不了，必须人做：')
  console.log('  用 Word 打开上面这个文件，点一下公式。')
  console.log('  能进入编辑状态 = 通过（OMML）。是一张图片 = 没通过，架构要改。')
}

function fail(msg: string): never {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
