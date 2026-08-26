/**
 * Skill = 一个固化的教师工作流，不是一段提示词。
 * 见 docs/claude.md §1：把流程固化，而不是每次靠提示词碰运气。
 */
export interface Skill {
  id: string
  /** 教师会怎么开口说这件事，用来做入口文案 */
  invocation: string
  /** 追加在 claude_code preset 之后的系统提示 */
  systemPrompt: string
  /** 这个 Skill 允许用的工具，含 mcp__ 前缀的。注意它只管「免确认」，不缩小工具集。 */
  allowedTools: string[]
  /**
   * 明确禁用的内置工具。
   *
   * Claude Code 默认带 30 多个工具（Task / Cron / Worktree / Monitor / Workflow…），
   * 对备课场景全是噪音，还会把工具总数推高到触发 tool search 延迟加载，
   * 结果模型找不到我们真正要它用的那几个。这里把用不上的关掉。
   */
  disallowedTools: string[]
  /** 产物文件名。UI 的中栏按这个开 tab */
  artifacts: string[]
}
