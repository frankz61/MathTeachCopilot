/**
 * 从教材树建课时的行为检查。
 *
 * 最要紧的一条：**已存在的课时绝不能被覆盖**。老师可能已经在里面存了
 * 一学期的东西，手滑点一下就清空是不可接受的。
 *
 *   pnpm --filter @mtc/desktop check:lesson
 */
import { mkdtempSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Workspace } from '@mtc/workspace'
import type { LessonMeta } from '@mtc/shared'

let failed = 0
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`)
  if (!ok) failed += 1
}

async function main(): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), 'mtc-lesson-'))
  const ws = new Workspace(root)

  const req = {
    textbook: '北师大版',
    grade: '九年级上册',
    chapterTitle: '第27章 一元二次方程',
    knowledgePointId: 'tp-27-03',
    knowledgePointTitle: '公式法与根的判别式',
  }

  const id = await ws.ensureLesson(req)
  check('建出课时', id === '北师大版九年级上册/第27章 一元二次方程/公式法与根的判别式', id)

  const lesson = await ws.readLesson(id)
  check('meta 带上了知识点 id', lesson.meta.standardRefs[0] === 'tp-27-03')
  check('meta 教材信息正确', lesson.meta.textbook === '北师大版' && lesson.meta.grade === '九年级上册')
  check('初始状态是未开始', lesson.meta.status === '未开始')
  check('problems.json 初始为空数组', lesson.problems.length === 0)

  // —— 最要紧的一条 ——
  await ws.writeProblems(id, [
    { id: 'keep-me', stem: '老师存了一学期的东西' } as never,
  ])
  await writeFile(path.join(ws.resolve(id), 'homework.md'), '# 别删我', 'utf-8')

  const again = await ws.ensureLesson(req)
  check('重复点同一个知识点返回同一个 id', again === id)

  const after = await ws.readLesson(id)
  check('已有题目没有被清空', after.problems.length === 1 && after.problems[0]?.id === 'keep-me',
    `实际 ${after.problems.length} 道`)
  check('已有 homework.md 没有被覆盖', after.homework === '# 别删我', String(after.homework))

  // 文件名里的非法字符
  const weird = await ws.ensureLesson({
    ...req,
    chapterTitle: '第1章 a/b:c*d?e"f<g>h|i',
    knowledgePointId: 'tp-x',
    knowledgePointTitle: '含 : 冒号 的 标题',
  })
  check('非法文件名字符被替换', !/[\\/:*?"<>|]/.test(weird.split('/').slice(1).join('')), weird)
  const weirdMeta = JSON.parse(
    await readFile(path.join(ws.resolve(weird), 'meta.json'), 'utf-8'),
  ) as LessonMeta
  check('替换后仍能正常读回', weirdMeta.standardRefs[0] === 'tp-x')

  // 列表里两个都在
  const all = await ws.listLessons()
  check('listLessons 找得到新建的课时', all.length === 2, `实际 ${all.length}`)

  // —— 上传图片 ——
  const png =
    'data:image/png;base64,' +
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const ref = await ws.saveAttachment(id, '试卷第3题.png', png)
  check('图片存进 assets/', !!ref && ref.startsWith('assets/upload-'), String(ref))
  check('扩展名正确', !!ref && ref.endsWith('.png'), String(ref))
  const back = await ws.readFigure(id, ref!)
  check('存进去的图能读回来', !!back && back.startsWith('data:image/png;base64,'))

  check('非图片被拒绝', (await ws.saveAttachment(id, 'a.txt', 'data:text/plain;base64,QQ==')) === null)
  check('坏的 data URI 被拒绝', (await ws.saveAttachment(id, 'a.png', '不是 data uri')) === null)

  const weirdRef = await ws.saveAttachment(id, '../../逃出去.png', png)
  check(
    '文件名里的路径符号被消掉',
    !!weirdRef && !weirdRef.includes('..'),
    String(weirdRef),
  )

  const ref2 = await ws.saveAttachment(id, '试卷第3题.png', png)
  check('同名图片不覆盖', ref2 !== ref, `${ref} vs ${ref2}`)

  // 越界防护
  let blocked = false
  try {
    ws.resolve('../../逃出去')
  } catch {
    blocked = true
  }
  check('路径越界被拦下', blocked)

  console.log()
  if (failed > 0) {
    console.error(`✗ ${failed} 项未通过`)
    process.exit(1)
  }
  console.log('从教材树建课时的行为正确，不会覆盖已有内容。')
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
