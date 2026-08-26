/**
 * 课时文件夹的读写。
 *
 * 刻意没有数据库：第一版只覆盖一章、几十道题，全读进内存即可。
 * 加索引的触发条件写在 docs/architecture.md §6，别凭感觉提前加。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  LESSON_FILES,
  type ConversationTurn,
  type LessonStatus,
  type CreateLessonRequest,
  type Curriculum,
  type Lesson,
  type LessonMeta,
  type Problem,
} from '@mtc/shared'

/** Windows 文件名不允许的字符，外加会让路径出歧义的点和空格结尾 */
function safeSegment(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, '-')
      // 连续的点会残留成「..-..-逃出去」这种文件名：分隔符换掉了，但 .. 还在。
      // 越界另有 resolve 的防线，这里纯粹是不想把 .. 留在文件名里给别的工具添乱。
      // 单个点不动——「21.2.2 公式法」这类课时名要靠它。
      .replace(/\.{2,}/g, '.')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[.\-\s]+/, '')
      .replace(/[.\-\s]+$/, '')
      .slice(0, 80)
  )
}

export class Workspace {
  constructor(readonly root: string) {}

  /** 递归找出所有含 meta.json 的目录 */
  async listLessons(): Promise<LessonMeta[]> {
    const found: LessonMeta[] = []
    const walk = async (dir: string): Promise<void> => {
      let entries
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      const hasMeta = entries.some((e) => e.isFile() && e.name === LESSON_FILES.meta)
      if (hasMeta) {
        const meta = await this.readJson<LessonMeta>(path.join(dir, LESSON_FILES.meta))
        if (meta) found.push({ ...meta, id: this.toId(dir) })
        return // 课时不嵌套
      }
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith('.')) await walk(path.join(dir, e.name))
      }
    }
    await walk(this.root)
    return found.sort((a, b) => a.id.localeCompare(b.id, 'zh'))
  }

  async readLesson(lessonId: string): Promise<Lesson> {
    const dir = this.resolve(lessonId)
    const meta = await this.readJson<LessonMeta>(path.join(dir, LESSON_FILES.meta))
    if (!meta) throw new Error(`课时不存在或缺 ${LESSON_FILES.meta}：${lessonId}`)

    const problems = (await this.readJson<Problem[]>(path.join(dir, LESSON_FILES.problems))) ?? []
    const homework = await this.readText(path.join(dir, LESSON_FILES.homework))
    let assets: string[] = []
    try {
      assets = await fs.readdir(path.join(dir, LESSON_FILES.assets))
    } catch {
      /* 没有 assets 目录是正常的 */
    }

    const conversation =
      (await this.readJson<ConversationTurn[]>(path.join(dir, LESSON_FILES.conversation))) ?? []

    return { meta: { ...meta, id: lessonId }, problems, homework, assets, conversation, dir }
  }

  /**
   * 注意：写 problems.json 是 Agent 通过内置 Write/Edit 工具做的，不走这里——
   * 那样才有 diff 可看、可采纳（docs/architecture.md §3）。
   * 这个方法只给种子数据和测试用。
   */
  async writeProblems(lessonId: string, problems: Problem[]): Promise<void> {
    const dir = this.resolve(lessonId)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      path.join(dir, LESSON_FILES.problems),
      JSON.stringify(problems, null, 2) + '\n',
      'utf-8',
    )
  }

  /**
   * 从教材树上的一个知识点建出课时文件夹。
   *
   * **已存在就原样返回，绝不覆盖**——老师可能已经在里面存了一学期的东西，
   * 手滑点一下就清空是不可接受的。
   */
  async ensureLesson(req: CreateLessonRequest): Promise<string> {
    const lessonId = [
      safeSegment(`${req.textbook}${req.grade}`),
      safeSegment(req.chapterTitle),
      safeSegment(req.knowledgePointTitle),
    ].join('/')

    const dir = this.resolve(lessonId)
    const metaFile = path.join(dir, LESSON_FILES.meta)
    try {
      await fs.access(metaFile)
      return lessonId // 已经有了
    } catch {
      /* 不存在，往下建 */
    }

    const meta: LessonMeta = {
      id: lessonId,
      textbook: req.textbook,
      grade: req.grade,
      chapter: req.chapterTitle,
      lesson: req.knowledgePointTitle,
      standardRefs: [req.knowledgePointId],
      periods: 1,
      status: '未开始',
      updatedAt: new Date().toISOString(),
    }
    await fs.mkdir(path.join(dir, LESSON_FILES.assets), { recursive: true })
    await fs.writeFile(metaFile, JSON.stringify(meta, null, 2) + '\n', 'utf-8')
    await fs.writeFile(path.join(dir, LESSON_FILES.problems), '[]\n', 'utf-8')
    return lessonId
  }

  /** 追加一轮对话。历史只增不删，老师想回看上次是怎么问的。 */
  async appendTurn(lessonId: string, turn: ConversationTurn): Promise<void> {
    const file = path.join(this.resolve(lessonId), LESSON_FILES.conversation)
    const history = (await this.readJson<ConversationTurn[]>(file)) ?? []
    history.push(turn)
    // 只留最近 200 轮，免得文件无限长；老师不会翻那么远
    await fs.writeFile(file, JSON.stringify(history.slice(-200), null, 2) + '\n', 'utf-8')
  }

  /** 补上这一轮的结论（跑完才知道） */
  async completeTurn(
    lessonId: string,
    turnId: string,
    patch: Pick<ConversationTurn, 'summary' | 'ok' | 'problemsAfter'>,
  ): Promise<void> {
    const file = path.join(this.resolve(lessonId), LESSON_FILES.conversation)
    const history = (await this.readJson<ConversationTurn[]>(file)) ?? []
    const hit = history.find((t) => t.id === turnId)
    if (!hit) return
    Object.assign(hit, patch)
    await fs.writeFile(file, JSON.stringify(history, null, 2) + '\n', 'utf-8')
  }

  /**
   * 剔除一道题。
   *
   * 老师的判断优先于 Agent 的产出——验算过了不代表适合这个班，
   * 而重新跑一轮 Agent 只为删一道题太贵了。
   */
  async deleteProblem(lessonId: string, problemId: string): Promise<void> {
    const dir = this.resolve(lessonId)
    const file = path.join(dir, LESSON_FILES.problems)
    const problems = (await this.readJson<Problem[]>(file)) ?? []
    const kept = problems.filter((p) => p.id !== problemId)
    if (kept.length === problems.length) return // 本来就没有，不写盘
    await fs.writeFile(file, JSON.stringify(kept, null, 2) + '\n', 'utf-8')
  }

  /** 更新课时状态（未开始 / 备课中 / 已定稿），只动 meta.json 里这一个字段 */
  async setStatus(lessonId: string, status: LessonStatus): Promise<void> {
    const file = path.join(this.resolve(lessonId), LESSON_FILES.meta)
    const meta = await this.readJson<LessonMeta>(file)
    if (!meta) return
    meta.status = status
    meta.updatedAt = new Date().toISOString()
    await fs.writeFile(file, JSON.stringify(meta, null, 2) + '\n', 'utf-8')
  }

  /**
   * 保存老师上传的图片到课时的 assets/。
   *
   * 只认图片类型，且大小设了上限——这个方法由渲染层直接调用，
   * 不能变成往用户磁盘写任意文件的通道。
   */
  async saveAttachment(
    lessonId: string,
    fileName: string,
    dataUri: string,
  ): Promise<string | null> {
    const m = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/i.exec(dataUri)
    if (!m) return null

    const buf = Buffer.from(m[3]!, 'base64')
    // 20MB：手机直出的照片一般 3-8MB，留够余量但不给无限大
    if (buf.byteLength > 20 * 1024 * 1024) return null

    const ext = m[2]!.toLowerCase() === 'jpg' ? 'jpeg' : m[2]!.toLowerCase()
    const base = safeSegment(fileName.replace(/\.[^.]*$/, '')) || 'upload'
    const stamp = Date.now().toString(36)
    const ref = `${LESSON_FILES.assets}/upload-${stamp}-${base}.${ext}`

    const dir = this.resolve(lessonId)
    const file = path.resolve(dir, ref)
    if (!file.startsWith(dir)) return null

    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, buf)
    return ref
  }

  /**
   * 把课时目录下的插图读成 data URI。
   *
   * 只允许读课时目录内的文件（resolve 已经挡了 ../ 越界），
   * 且只认图片扩展名——这个方法会被渲染层直接调用，不能变成任意文件读取。
   */
  async readFigure(lessonId: string, ref: string): Promise<string | null> {
    const mime: Record<string, string> = {
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
    }
    const ext = path.extname(ref).toLowerCase()
    const type = mime[ext]
    if (!type) return null

    const dir = this.resolve(lessonId)
    const file = path.resolve(dir, ref)
    if (!file.startsWith(dir)) return null // 越界

    try {
      const buf = await fs.readFile(file)
      return `data:${type};base64,${buf.toString('base64')}`
    } catch {
      return null
    }
  }

  /** 课时目录的绝对路径。Agent 的 cwd 就是它。 */
  resolve(lessonId: string): string {
    const abs = path.resolve(this.root, lessonId)
    // 防止 ../ 逃出工作区
    if (!abs.startsWith(path.resolve(this.root))) {
      throw new Error(`课时路径越界：${lessonId}`)
    }
    return abs
  }

  private toId(dir: string): string {
    return path.relative(this.root, dir).split(path.sep).join('/')
  }

  private async readJson<T>(file: string): Promise<T | null> {
    try {
      return JSON.parse(await fs.readFile(file, 'utf-8')) as T
    } catch {
      return null
    }
  }

  private async readText(file: string): Promise<string | null> {
    try {
      return await fs.readFile(file, 'utf-8')
    } catch {
      return null
    }
  }
}

/** 教材树是只读配置数据，不在教师工作区里，随包走。 */
export async function loadCurriculum(dir: string): Promise<Curriculum[]> {
  let files: string[]
  try {
    files = await fs.readdir(dir)
  } catch {
    return []
  }
  const out: Curriculum[] = []
  for (const f of files.filter((f) => f.endsWith('.json'))) {
    out.push(JSON.parse(await fs.readFile(path.join(dir, f), 'utf-8')) as Curriculum)
  }
  return out
}
