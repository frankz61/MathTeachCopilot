/**
 * Agent 编排。刻意不 import electron —— 这样 scripts/spike.ts 能在没有 UI 的
 * 情况下跑同一条链路，这是 docs/architecture.md 第十节那个 spike 的前提。
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { skills, type SkillId } from '@mtc/skills'
import type { AgentEvent, KnowledgePoint, LessonMeta, RunStats } from '@mtc/shared'
import { mathtoolsServer } from './mcp.js'
import { buildAgentEnv, resolveModelConfig, type ModelConfig } from './config.js'

export interface RunOptions {
  /** 课时目录的绝对路径。Agent 的 cwd 就是它，产物直接落在这里。 */
  lessonDir: string
  skillId: SkillId
  prompt: string
  /** 打包后传 process.resourcesPath */
  baseDir: string
  /** 仓库根（开发期读 .env 用）。打包后应换成应用自己的设置文件。 */
  configRoot: string
  /** 显式覆盖模型接入配置，不传则按 config.ts 的优先级解析 */
  modelConfig?: ModelConfig
  /** 教材数据目录，交给 lookup_curriculum 工具用 */
  curriculumDir?: string
  /** 会话包：这节课是什么。见下方 buildPrompt 的说明 */
  lesson?: LessonContext
  /** 老师这次上传的图片，相对课时目录的路径 */
  attachments?: string[]
  onEvent: (e: AgentEvent) => void
}

export interface LessonContext {
  meta: LessonMeta
  problemCount: number
  /**
   * 已解析好的知识点详情。
   *
   * 主进程本来就把教材数据读在内存里，直接塞进会话包比让 Agent 再调一次
   * lookup_curriculum 快，也更靠谱——尤其是那 51 条常见错因，
   * 放在工具返回值里模型可能压根不去查，放在提示词里它想忽略都难。
   */
  knowledgePoints?: KnowledgePoint[]
  /**
   * 课时 assets/ 下已有的图，以及有没有题在用它。
   *
   * 不给这个的后果实测过：**上一轮生成的图，下一轮完全不知道它存在。**
   * 「正数和负数」那节课的 temp_number_line.svg 就是这么变成孤儿的——
   * 第一轮画了数轴、那一轮中断，第二轮「继续生成」写了 8 道题，
   * 没有一道引用它。工作区里这样的孤儿图有 4 张。见 architecture.md §4.21。
   */
  figures?: { name: string; used: boolean }[]
}

/**
 * 会话包。
 *
 * grok.md 第七节：「每次调用至少带齐：年级、教材版本、本课知识点、课时。
 * 没有这些，生成永远是网课模板。」
 *
 * 实测过不带的后果比「模板化」更糟：老师输入「生成三道题目」，Agent 不知道
 * 自己在教哪一节，先去翻文件找上下文，翻不到就收尾了事——一道题没出，
 * 界面上看就是「没反应」。基本信息应该直接给它，不该让它去猜。
 */
function buildPrompt(
  prompt: string,
  lesson: LessonContext | undefined,
  attachments: string[] = [],
): string {
  if (!lesson) return attachments.length > 0 ? withAttachments(prompt, attachments) : prompt
  const { meta, problemCount } = lesson
  const lines = [
    '<课时>',
    `教材：${meta.textbook} ${meta.grade}`,
    `章节：${meta.chapter}`,
    `课时：${meta.lesson}`,
    `课时数：${meta.periods}`,
    `知识点 id：${meta.standardRefs.join('、') || '(未指定)'}`,
    `当前已有题目：${problemCount} 道`,
    '</课时>',
    '',
  ]
  const kps = lesson.knowledgePoints ?? []
  if (kps.length > 0) {
    lines.push('<知识点>')
    for (const kp of kps) {
      lines.push(`${kp.id} ${kp.title}`)
      if (kp.desc) lines.push(`  内容：${kp.desc}`)
      if (kp.examWeight) {
        lines.push(
          `  中考权重：${kp.examWeight}${kp.examWeight === 'high' ? '（高频，值得多出题）' : ''}`,
        )
      }
      if (kp.commonErrors.length > 0) {
        lines.push('  常见错因：')
        for (const e of kp.commonErrors) lines.push(`    - ${e}`)
      }
      if (kp.prerequisites?.length) {
        lines.push(`  前置知识点：${kp.prerequisites.join('、')}（需要时用 lookup_curriculum 查）`)
      }
    }
    lines.push('</知识点>', '')
    lines.push(
      '上面的信息已经够开始出题了，不必再查一遍。',
      '常见错因是好素材：B/C 层可以刻意设计成会踩这些坑的题，让学生错一次记住。',
      '',
    )
  } else if (meta.standardRefs.length > 0) {
    lines.push(
      `课时标了知识点 ${meta.standardRefs.join('、')}，但教材数据里查不到它们。`,
      '用 lookup_curriculum 按关键词搜一下，或者直接按课时名判断该考什么。',
      '',
    )
  }
  const figures = lesson.figures ?? []
  if (figures.length > 0) {
    lines.push('<课时里已有的图>')
    for (const f of figures) {
      lines.push(`assets/${f.name}${f.used ? '' : '　← 还没有题引用它'}`)
    }
    lines.push('</课时里已有的图>')
    lines.push(
      '标了「还没有题引用它」的图，要么这次用起来（把路径写进 figureRefs 并在题干里引用），',
      '要么当它不存在——但**不要重画一张一模一样的**。',
      '',
    )
  }
  if (attachments.length > 0) lines.push(...attachmentLines(attachments), '')
  lines.push('<老师说>', prompt, '</老师说>')
  return lines.join('\n')
}

/**
 * 附件不塞进提示词的内容里，只给路径 —— 图片已经落在课时目录，
 * 让 Agent 用 Read 去看。好处是这张图从此属于工作区：能当题目配图复用、
 * 能随卷子导出、老师也能直接打开。
 */
function attachmentLines(attachments: string[]): string[] {
  return [
    '<老师上传的图片>',
    ...attachments,
    '</老师上传的图片>',
    '',
    '**先用 Read 工具把上面每张图看一遍**，再回应老师。',
    '图已经存在课时目录里，可以直接当题目配图用（写进 figureRefs），不必重画。',
  ]
}

/** 没有课时上下文时的简版 */
function withAttachments(prompt: string, attachments: string[]): string {
  return [...attachmentLines(attachments), '', '<老师说>', prompt, '</老师说>'].join('\n')
}

export interface RunHandle {
  done: Promise<void>
  interrupt: () => Promise<void>
}

/**
 * 数一下 problems.json 里有几道题。读不到就当 0。
 *
 * 用途见下面 done 分支：**不能只信 Agent 说「已写入」**。
 */
async function countProblems(lessonDir: string): Promise<number> {
  try {
    const raw = await readFile(path.join(lessonDir, 'problems.json'), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}

/**
 * 从 result 消息里取这一轮的耗时账单。
 *
 * turns 是这里最该看的一个数：Agent 每多来回一轮就是一次完整的网络往返，
 * 如果接入的网关每次请求有固定开销（实测这个网关 1.2~10.6 秒，抖动很大），总时长就是
 * 「固定开销 x turns + 真正的生成时间」。光看总时长会误判成「模型慢」。
 *
 * cacheReadTokens 是第二个信号：它一直是 0 说明提示词缓存没生效，每一轮都在重新
 * 发送并计费整套系统提示和工具定义。实测这是**按模型别名**变化的——同一个网关上
 * auto/claude-sonnet 命中 9 万多 token，mathcopilot 一个都没有。
 */
function statsOf(m: {
  duration_ms: number
  duration_api_ms?: number
  num_turns?: number
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
  }
}): RunStats {
  return {
    ms: m.duration_ms,
    apiMs: m.duration_api_ms,
    turns: m.num_turns,
    inputTokens: m.usage?.input_tokens,
    outputTokens: m.usage?.output_tokens,
    cacheReadTokens: m.usage?.cache_read_input_tokens,
  }
}

export function runAgent(opts: RunOptions): RunHandle {
  const skill = skills[opts.skillId]
  const { onEvent } = opts
  const config = resolveModelConfig(opts.configRoot, opts.modelConfig)

  const q = query({
    prompt: buildPrompt(opts.prompt, opts.lesson, opts.attachments),
    options: {
      cwd: opts.lessonDir,
      // 换模型不用改代码，配合中继就是完整的模型可替换接缝
      model: config.model ?? 'claude-opus-5',

      // 在 Claude Code 的预设之上追加 Skill 的系统提示，而不是整个替换掉——
      // 预设里的文件编辑纪律（diff、最小改动）正是我们想要的。
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: skill.systemPrompt,
      },

      // 白名单授权，不用 bypassPermissions。写文件有 diff 兜底，
      // 但导出这类动作的闸门在 Python 工具层，不靠权限模式。
      allowedTools: skill.allowedTools,
      disallowedTools: skill.disallowedTools,
      permissionMode: 'default',

      // 把生效配置一并交给工具进程：render_illustration 要调网关的图接口，
      // 凭据不显式传就只能报「没配置」。见 mcp.ts 里 toolEnv 的注释。
      mcpServers: { mathtools: mathtoolsServer(opts.baseDir, opts.curriculumDir, config) },

      // 不读教师机器上的 ~/.claude 和项目配置：这是产品，行为必须可预测，
      // 不能被用户本地的 Claude Code 设置意外改变。
      settingSources: [],

      // 同理，凭据也不继承宿主环境，全部由 config 显式给。见 config.ts 的注释。
      env: buildAgentEnv(config),
    },
  })

  const done = (async () => {
    const before = await countProblems(opts.lessonDir)
    try {
      for await (const message of q) {
        if (message.type === 'system' && message.subtype === 'init') {
          onEvent({
            type: 'init',
            tools: message.tools ?? [],
            mcpServers: (message.mcp_servers ?? []).map((s) => ({
              name: s.name,
              status: s.status,
            })),
          })
          const broken = (message.mcp_servers ?? []).filter(
            (s) => s.status === 'failed' || s.status === 'needs-auth',
          )
          if (broken.length > 0) {
            onEvent({
              type: 'error',
              message:
                `数学工具进程未连上：${broken.map((s) => s.name).join(', ')}。` +
                `验算不可用，这一轮生成的题一律不可信。`,
            })
          }
          continue
        }

        if (message.type === 'assistant') {
          for (const block of message.message.content) {
            if (block.type === 'text' && block.text.trim()) {
              onEvent({ type: 'text', text: block.text })
            } else if (block.type === 'tool_use') {
              onEvent({ type: 'tool', name: block.name })
              const filePath = fileTargetOf(block.name, block.input)
              if (filePath) {
                onEvent({
                  type: 'file',
                  path: filePath,
                  action: block.name === 'Edit' ? 'edit' : 'write',
                })
              }
            }
          }
          continue
        }

        if (message.type === 'result') {
          if (message.subtype !== 'success') {
            onEvent({
              type: 'done',
              ok: false,
              summary: `执行未正常结束：${message.subtype}`,
              stats: statsOf(message),
            })
            continue
          }

          // 不能只信 Agent 说「已写入 problems.json」。实测遇到过：它连说四轮
          // 「开始出三道题并写入」，一道也没写，而 result 仍然是 success——
          // UI 于是显示一个绿色的成功框，老师以为成好了。核对一下文件再说。
          const after = await countProblems(opts.lessonDir)
          if (after === before) {
            onEvent({
              type: 'done',
              ok: false,
              summary:
                `这一轮没有产出任何题目（problems.json 仍是 ${before} 道）。\n` +
                `模型说：${message.result.trim().slice(0, 160)}\n` +
                `换个更具体的说法再试，比如「出 3 道 A 层的题，现在就写进 problems.json」。` +
                `如果反复如此，多半是当前模型撑不住这套工具流程，换个模型试试。`,
              stats: statsOf(message),
            })
            continue
          }
          onEvent({ type: 'done', ok: true, summary: message.result, stats: statsOf(message) })
        }
      }
    } catch (err) {
      onEvent({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  })()

  return {
    done,
    interrupt: async () => {
      await q.interrupt()
    },
  }
}

/**
 * 从工具调用里认出写文件动作。
 *
 * 注意这只用来在事件流里显示「正在写 xxx」——**不要拿它触发界面刷新**。
 * tool_use 是「发起调用」的时刻，文件还没落盘，此时去读会读到旧内容。
 * 刷新由主进程的目录监听负责，见 watcher.ts。
 */
function fileTargetOf(toolName: string, input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  // problems.json 不走 Write，走 save_problems（见 tools-py/mathtools/store.py 的说明）
  const key =
    toolName === 'Write' || toolName === 'Edit'
      ? 'file_path'
      : toolName.endsWith('__save_problems')
        ? 'out_path'
        : null
  if (!key) return null
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}
