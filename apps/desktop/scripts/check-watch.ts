/**
 * 验证课时目录监听真的会触发。
 *
 * 这是「加了一道题界面不刷新」那个 bug 的回归检查。原因是刷新曾挂在 agent 的
 * file 事件上，而那是**发起工具调用**的时刻、文件还没落盘，读到的是旧内容。
 * 改成监听目录后，谁写的都算。
 *
 *   pnpm --filter @mtc/desktop check:watch
 */
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { LessonWatcher } from '../src/main/watcher.js'

const CASES: { name: string; run: (dir: string) => void; expect: boolean }[] = [
  {
    name: 'save_problems 写 problems.json',
    run: (d) => writeFileSync(path.join(d, 'problems.json'), '[{"id":"p1"}]', 'utf-8'),
    expect: true,
  },
  {
    name: '老师用别的编辑器改 homework.md',
    run: (d) => writeFileSync(path.join(d, 'homework.md'), '# 改过了', 'utf-8'),
    expect: true,
  },
  {
    name: '子目录里新增插图',
    run: (d) => {
      mkdirSync(path.join(d, 'assets'), { recursive: true })
      writeFileSync(path.join(d, 'assets', 'f1.svg'), '<svg/>', 'utf-8')
    },
    expect: true,
  },
  {
    name: '编辑器临时文件（应被忽略）',
    run: (d) => writeFileSync(path.join(d, '.problems.json.swp'), 'x', 'utf-8'),
    expect: false,
  },
]

async function main(): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), 'mtc-watch-'))
  let fired = 0
  const watcher = new LessonWatcher(() => {
    fired += 1
  })
  watcher.watchDir(dir)
  await sleep(200) // 给 fs.watch 一点时间挂上

  let failed = 0
  for (const c of CASES) {
    fired = 0
    c.run(dir)
    await sleep(500) // 覆盖 watcher 的 180ms 抖动合并
    const ok = c.expect ? fired > 0 : fired === 0
    console.log(`  ${ok ? '✓' : '✗'} ${c.name}${ok ? '' : `（期望${c.expect ? '触发' : '不触发'}，实际触发 ${fired} 次）`}`)
    if (!ok) failed += 1
  }

  // 多个文件连续写入应合并成一次通知，否则 UI 会被刷屏
  fired = 0
  for (let i = 0; i < 5; i++) writeFileSync(path.join(dir, `f${i}.md`), 'x', 'utf-8')
  await sleep(500)
  const merged = fired === 1
  console.log(`  ${merged ? '✓' : '✗'} 连续 5 次写入合并成 1 次通知（实际 ${fired} 次）`)
  if (!merged) failed += 1

  watcher.stop()
  fired = 0
  writeFileSync(path.join(dir, 'after-stop.md'), 'x', 'utf-8')
  await sleep(400)
  const stopped = fired === 0
  console.log(`  ${stopped ? '✓' : '✗'} stop() 后不再触发`)
  if (!stopped) failed += 1

  console.log()
  if (failed > 0) {
    console.error(`✗ ${failed} 项未通过`)
    process.exit(1)
  }
  console.log('文件监听正常，界面会跟着文件走。')
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
