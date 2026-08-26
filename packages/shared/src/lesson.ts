/**
 * 课时 = 一个文件夹。见 docs/architecture.md §6。
 * 文件是唯一事实来源，没有数据库。
 */
import type { Problem } from './problem.js'

export type LessonStatus = '未开始' | '备课中' | '已定稿'

export interface LessonMeta {
  /** 相对工作区根的路径，如 人教八下/17-一元二次方程/02-配方法 */
  id: string
  textbook: string
  grade: string
  chapter: string
  lesson: string
  /** 课标条目 ID，对应 curriculum/ */
  standardRefs: string[]
  periods: number
  status: LessonStatus
  updatedAt: string
}

/** 一个课时文件夹读进内存后的样子 */
export interface Lesson {
  meta: LessonMeta
  /** problems.json */
  problems: Problem[]
  /** homework.md，没有则为 null */
  homework: string | null
  /** assets/ 下的文件名 */
  assets: string[]
  /** 这个课时的提问历史，新的在后 */
  conversation: ConversationTurn[]
  /** 绝对路径 */
  dir: string
}

/**
 * 一轮对话。存在课时目录的 conversation.json 里。
 *
 * 老师问过什么是有价值的：他会想「上次那句话是怎么说的」再复用，
 * 也是 docs/claude.md 第二节说的「教师档案靠动作自动积累」的原料。
 * 清空重来等于每次都从零开始。
 */
export interface ConversationTurn {
  id: string
  /** ISO 8601 */
  at: string
  prompt: string
  /** 收尾时的结论；还没跑完就是 null */
  summary: string | null
  ok: boolean | null
  /** 这一轮之后题目数的变化，用来一眼看出哪次真的有产出 */
  problemsBefore: number
  problemsAfter: number | null
}

export const LESSON_FILES = {
  meta: 'meta.json',
  problems: 'problems.json',
  homework: 'homework.md',
  assets: 'assets',
  conversation: 'conversation.json',
} as const
