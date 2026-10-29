/**
 * 教学设计（design.json）。
 *
 * 体例照《教学设计与指导》（北师版）的课时教学设计：教学内容 → 教学目标 →
 * 重点难点 → 教学路径 → 教学过程（导入语 + 若干环节，每个环节由问题、追问、
 * 师生活动、设计意图等块按顺序组成）。
 *
 * 两条约定决定了它和「让模型写一篇教案」的区别：
 *
 * 1. **题不写在这里。** 例题、课堂练习、目标检测都在 problems.json 里，这里只按 id
 *    引用（`{ kind: '题目', problemId }`）。题因此和作业题走同一道验算闸门，
 *    改一处、教学设计和作业同时变。
 * 2. **只能经 save_design 写。** 它会核对引用的题存在、每个环节都有设计意图、
 *    每条教学目标都有环节落实——机器查得出的毛病不留给老师去发现。
 */

/** 环节里的文字块。问题 / 追问的编号由界面和导出按出现顺序生成，不存 */
export type DesignTextKind =
  | '问题'
  | '追问'
  | '情境'
  | '师生活动'
  | '讲解'
  | '过渡语'
  | '评价语'
  | '说明'
  | '设计意图'

export const DESIGN_TEXT_KINDS: readonly DesignTextKind[] = [
  '问题',
  '追问',
  '情境',
  '师生活动',
  '讲解',
  '过渡语',
  '评价语',
  '说明',
  '设计意图',
]

export type DesignBlock =
  | { kind: DesignTextKind; text: string }
  /** 引用 problems.json 里的一道题（例题 / 练习 / 检测 / 作业） */
  | { kind: '题目'; problemId: string }

export interface DesignStage {
  id: string
  /** 如「章头引领，概览全貌」。「环节一」这类序号由界面生成 */
  title: string
  /** 这个环节落实哪几条教学目标（Objective.id） */
  objectiveIds: string[]
  blocks: DesignBlock[]
}

export interface Objective {
  id: string
  text: string
}

export interface TeachingDesign {
  /** 教学内容，如「章首页，线段、射线、直线」 */
  content: string
  /** 学情分析：学生已有什么、可能卡在哪。样例里没有，备课要求里有 */
  learnerAnalysis: string
  objectives: Objective[]
  keyPoints: string[]
  difficulties: string[]
  /** 教学路径。流程图以后再做，先用文字（如「小学经验 → 观察图形抽象概念 → …」） */
  path: string
  /** 导入语 */
  intro: string
  stages: DesignStage[]
  /** 板书设计，可空 */
  boardPlan: string
  /** 由 save_design 写 */
  updatedAt: string
}

/** 环节序号：环节一、环节二……超过十个的教学设计本身就有问题，不必处理更多 */
export function stageLabel(index: number): string {
  const digits = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  return `环节${digits[index] ?? String(index + 1)}`
}
