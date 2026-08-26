/**
 * 题目对象。字段集照搬 docs/grok.md §6：
 * 缺任何一项就不是题库对象，只是散文。
 */

/** 三态。语义见 docs/decision.md —— 要在 UI 上像 git 的 unstaged 一样显眼。 */
export type VerifyStatus =
  /** CAS / 标签 / 解析三关都过，可导出给学生 */
  | 'green'
  /** 开放题、几何缺图、检查器覆盖不到，仅教师预览 */
  | 'yellow'
  /** 验算失败或与解析矛盾，禁止导出 */
  | 'red'

/** 分层：A 基础 / B 提升 / C 拓展 */
export type Tier = 'A' | 'B' | 'C'

export type ProblemType = '选择' | '填空' | '解答' | '证明' | '作图'

/** 单条验算路径的结果。一道题要过两条独立路径才算绿。 */
export interface VerifyPath {
  /** 例如 'sympy.solve' / 'substitute-back' */
  name: string
  ok: boolean
  detail: string
}

export interface VerifyResult {
  status: VerifyStatus
  /** ISO 8601 */
  checkedAt: string
  paths: VerifyPath[]
  /** 人能读的失败原因；green 时可为空 */
  log: string
}

/** 变式种子：同结构可换数。没有它就没法"再来三道同源题"。 */
export interface VariantSeed {
  /** 参数化题干模板，占位符形如 {a} {b} {c} */
  template: string
  params: Record<string, number>
  /** 换数时必须维持的约束，交给 verify_answer_shape 检查 */
  constraints: string[]
}

/**
 * 这道题该怎么机器验。
 *
 * **必须跟着题目一起落盘**：老师改完题要重新验算，规格丢了就只能降级成
 * 「教师改过、无法再验证」，那等于把产品最硬的那条保证废掉。
 */
export type AlgebraCheck =
  | { kind: 'solve'; equation: string; variable?: string; claimed_roots: string[] }
  | { kind: 'identity'; left: string; right: string }
  | { kind: 'evaluate'; expression: string; substitutions: Record<string, string>; claimed: string }

export interface ManualCheck {
  kind: 'manual'
  reason: string
}

/**
 * 选择题。
 *
 * 单列一档是必要的：选择题的答案是「B」一个字母，solve/identity/evaluate 三种
 * 都表达不了「B 对应的值是 2，而 A/C/D 都不是 2」。没有这一档时选择题只能标
 * manual → 黄色，而提示词又把 manual 当降级，于是模型理性地回避选择题——
 * 实测 72 道题里选择题只占 11%，且 8 道里 7 道是黄的。见 architecture.md §4.16。
 *
 * `basis` 说明正确答案怎么算出来，决定这道题能不能变绿：
 * 给代数依据就能绿，给 manual（概念判断、命题真假）则只能到黄，
 * 但**干扰项互异性检查照样会跑**。
 */
export interface ChoiceCheck {
  kind: 'choice'
  /** 正确选项的键，必须存在于 Problem.options 里 */
  correct: string
  basis: AlgebraCheck | ManualCheck
}

export type ProblemCheck = AlgebraCheck | ManualCheck | ChoiceCheck

export interface Problem {
  id: string
  /** Markdown + LaTeX。图片以 ![](assets/xxx.svg) 引用 */
  stem: string
  /** 引用到 assets/ 下的图，便于校验"图与题干同源" */
  figureRefs: string[]
  answer: string
  /** 分步解析，一步一项 */
  solution: string[]
  /** 课标知识点 ID，对应 curriculum/ 下的节点 */
  knowledgePointIds: string[]
  tier: Tier
  type: ProblemType
  /**
   * 选择题的选项，键是选项号（A/B/C/D）。
   *
   * **选项不写进 stem。** 写进题干的后果是：导出时没法单独排版、没法只换干扰项
   * 出变式、更要紧的是没法校验「有且仅有一个正确选项」——两个选项都对是选择题
   * 最典型的硬伤，选项藏在字符串里就什么都拦不住。
   *
   * 可选是为了兼容既有数据（早期的选择题把选项写在题干里）。
   */
  options?: Record<string, string>
  /** null = 还没验算过。UI 上等同于"未验证"，不可导出 */
  verify: VerifyResult | null
  /** 验算规格。老式数据可能没有，那种题改完只能标黄。 */
  check?: ProblemCheck
  variantSeed: VariantSeed | null
  source: 'generated' | 'retrieved'
  createdAt: string
}

/** 导出闸门：红色和未验证一律拦下。放在工具层强制，不依赖模型自觉。 */
export function exportableProblems(problems: Problem[]): {
  ok: Problem[]
  blocked: { problem: Problem; reason: string }[]
} {
  const ok: Problem[] = []
  const blocked: { problem: Problem; reason: string }[] = []
  for (const p of problems) {
    if (p.verify === null) {
      blocked.push({ problem: p, reason: '未验证' })
    } else if (p.verify.status === 'red') {
      blocked.push({ problem: p, reason: `验算失败：${p.verify.log}` })
    } else {
      ok.push(p)
    }
  }
  return { ok, blocked }
}
