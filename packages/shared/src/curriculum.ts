/** 教材树。做成可配置数据，不硬编码——见 docs/claude.md 第七节的风险表。 */

/** 中考权重。high=高频必考 / medium=常考 / low=了解 / optional=选学 */
export type ExamWeight = 'high' | 'medium' | 'low' | 'optional'

export interface KnowledgePoint {
  id: string
  title: string
  /**
   * 2022 版课标条目原文。
   *
   * **没有可靠来源时必须留空**，不要拿内容摘要冒充——出题 Skill 的系统提示里
   * 明写了「不要凭记忆写课标条目号」，如果这里塞的是摘要，模型会当成课标原文用。
   * 摘要放 desc。
   */
  standard: string
  /** 这个知识点讲什么，来自教材目录的内容摘要 */
  desc?: string
  examWeight?: ExamWeight
  /** 前置知识点 id。出题时可用来判断某种解法是否超前。 */
  prerequisites?: string[]
  /** 常见错因，喂给错因诊断 Skill；也可用于出题时刻意规避或刻意命中 */
  commonErrors: string[]
}

export interface CurriculumNode {
  id: string
  title: string
  desc?: string
  examWeight?: ExamWeight
  children?: CurriculumNode[]
  knowledgePoints?: KnowledgePoint[]
}

export interface Curriculum {
  textbook: string
  grade: string
  /** 数据出处，便于追责——教材数据错了比模型答错更难发现 */
  source?: string
  nodes: CurriculumNode[]
}

/**
 * 递归收集全部知识点。
 *
 * 教材树深浅不一：北师大版是「章 → 知识点」两层，人教版手工整理的是
 * 「章 → 节 → 知识点」三层。只数顶层会漏掉后者，所以统一走这个函数。
 */
export function allKnowledgePoints(nodes: CurriculumNode[]): KnowledgePoint[] {
  const out: KnowledgePoint[] = []
  const walk = (list: CurriculumNode[]): void => {
    for (const n of list) {
      if (n.knowledgePoints) out.push(...n.knowledgePoints)
      if (n.children) walk(n.children)
    }
  }
  walk(nodes)
  return out
}

export function findKnowledgePoint(c: Curriculum, id: string): KnowledgePoint | null {
  const walk = (nodes: CurriculumNode[]): KnowledgePoint | null => {
    for (const n of nodes) {
      const hit = n.knowledgePoints?.find((k) => k.id === id)
      if (hit) return hit
      if (n.children) {
        const deep = walk(n.children)
        if (deep) return deep
      }
    }
    return null
  }
  return walk(c.nodes)
}
