import type { ReactElement, ReactNode } from 'react'
import {
  stageLabel,
  usageOf,
  type DesignBlock,
  type Problem,
  type TeachingDesign,
  type VerifyStatus,
} from '@mtc/shared'
import { Math } from './Math.js'
import { Figure } from './Figure.js'

/**
 * 教学设计视图。版式照《教学设计与指导》：栏目名做成色块标签，
 * 一眼分得出哪句是问题、哪句是师生活动、哪句是设计意图。
 *
 * 题目块渲染成内嵌题卡，**带验证状态点**——教案里的例题和作业里的题
 * 同样会被印出来、讲给学生听，黄的要让老师看得见。
 */
export function DesignView({
  design,
  problems,
  lessonId,
}: {
  design: TeachingDesign
  problems: Problem[]
  lessonId: string
}): ReactElement {
  const byId = new Map(problems.map((p) => [p.id, p]))
  const objectiveNo = new Map(design.objectives.map((o, i) => [o.id, i + 1]))

  // 问题全篇连续编号，追问在每个问题下重新从 1 数——和样例书一致
  let q = 0
  let follow = 0
  const label = (b: DesignBlock): string => {
    if (b.kind === '问题') {
      q += 1
      follow = 0
      return `问题 ${q}`
    }
    if (b.kind === '追问') {
      follow += 1
      return `追问 ${follow}`
    }
    return b.kind
  }

  return (
    <div className="design">
      <DesignSection title="教学内容">
        <Math>{design.content}</Math>
      </DesignSection>
      {design.learnerAnalysis && (
        <DesignSection title="学情分析">
          <Math>{design.learnerAnalysis}</Math>
        </DesignSection>
      )}
      <DesignSection title="教学目标">
        <ol className="design-list">
          {design.objectives.map((o) => (
            <li key={o.id}>
              <Math>{o.text}</Math>
            </li>
          ))}
        </ol>
      </DesignSection>
      <DesignSection title="教学重点与难点">
        <p>
          <b>重点</b>　<Math>{design.keyPoints.join('；')}</Math>
        </p>
        <p>
          <b>难点</b>　<Math>{design.difficulties.join('；')}</Math>
        </p>
      </DesignSection>
      {design.path && (
        <DesignSection title="教学路径">
          <p className="design-path">{design.path}</p>
        </DesignSection>
      )}

      <DesignSection title="教学过程设计">
        {design.intro && (
          <div className="d-block">
            <span className="d-tag d-tag-导入语">导入语</span>
            <Math>{design.intro}</Math>
          </div>
        )}
        {design.stages.map((stage, i) => (
          <section key={stage.id} className="d-stage">
            <h4 className="d-stage-title">
              <span className="d-stage-no">{stageLabel(i)}</span>
              {stage.title}
              <span className="d-objs" title="这个环节落实的教学目标">
                目标 {stage.objectiveIds.map((id) => objectiveNo.get(id) ?? id).join('、')}
              </span>
            </h4>
            {stage.blocks.map((b, j) =>
              b.kind === '题目' ? (
                <ProblemRef key={j} problem={byId.get(b.problemId)} id={b.problemId} lessonId={lessonId} />
              ) : (
                <div key={j} className={`d-block d-kind-${b.kind}`}>
                  <span className={`d-tag d-tag-${b.kind}`}>{label(b)}</span>
                  <Math>{b.text}</Math>
                </div>
              ),
            )}
          </section>
        ))}
      </DesignSection>

      {design.boardPlan && (
        <DesignSection title="板书设计">
          <Math>{design.boardPlan}</Math>
        </DesignSection>
      )}
    </div>
  )
}

function DesignSection({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="d-section">
      <h3 className="d-section-title">{title}</h3>
      {children}
    </section>
  )
}

/** 引用的题。题被删了要显眼地说出来——导出的教案里那一处会是空的 */
function ProblemRef({
  problem,
  id,
  lessonId,
}: {
  problem: Problem | undefined
  id: string
  lessonId: string
}): ReactElement {
  if (!problem) {
    return (
      <div className="d-problem missing">
        引用的题 <code>{id}</code> 已不在题目列表里。让 Agent 重新出一道，或把这一处删掉。
      </div>
    )
  }
  const status: VerifyStatus | 'unverified' = problem.verify?.status ?? 'unverified'
  const correct = problem.check?.kind === 'choice' ? problem.check.correct : null
  return (
    <div className={`d-problem status-${status}`}>
      <div className="d-problem-head">
        <span className="d-tag d-tag-题目">{usageOf(problem)}</span>
        <span className="p-type">
          {problem.tier} · {problem.type}
        </span>
        <span className="spacer" />
        <i className={`dot dot-${status}`} title={status} />
      </div>
      <Math>{problem.stem.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim()}</Math>
      {problem.options && (
        <ol className="options">
          {Object.entries(problem.options)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, text]) => (
              <li key={k} className={k === correct ? 'opt-row correct' : 'opt-row'}>
                <span className="opt-key">{k}</span>
                <Math>{text}</Math>
              </li>
            ))}
        </ol>
      )}
      {problem.figureRefs.map((ref) => (
        <Figure key={ref} lessonId={lessonId} refPath={ref} />
      ))}
      <div className="answer">
        <span className="label">答案</span>
        <Math>{problem.answer}</Math>
      </div>
    </div>
  )
}
