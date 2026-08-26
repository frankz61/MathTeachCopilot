import { useState, type ReactElement } from 'react'
import { exportableProblems, type Lesson, type Problem, type VerifyStatus } from '@mtc/shared'
import { Math } from './Math.js'
import { HomeworkView } from './HomeworkView.js'
import { Figure } from './Figure.js'
import { ProblemEditor } from './ProblemEditor.js'
import { VariantDialog } from './VariantDialog.js'
import { api } from '../devFixture.js'

interface Props {
  lesson: Lesson | null
  /** 出变式：对话框里选好方向和数量后，把拼好的提示词交出去 */
  onVariant: (prompt: string) => void
  onDelete: (problemId: string) => void
  busy: boolean
}

type Status = VerifyStatus | 'unverified'

/** 去掉题干里的 markdown 图片语法，只留文字。插图由 Figure 组件单独渲染。 */
function stripImages(stem: string): string {
  return stem
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const STATUS_LABEL: Record<Status, string> = {
  green: '已验证',
  yellow: '待确认',
  red: '验算失败',
  unverified: '未验证',
}

/**
 * 中栏：产物。
 *
 * 这里最重要的不是好看，是**验证状态必须一眼可辨**——要像 git 的 unstaged 一样，
 * 老师扫一遍就知道哪些题不能发给学生。见 docs/decision.md 第三节。
 */
export function ArtifactPane({ lesson, onVariant, onDelete, busy }: Props): ReactElement {
  const [tab, setTab] = useState<'problems' | 'homework'>('problems')
  const [withAnswers, setWithAnswers] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState<string | null>(null)
  // 点「出变式」后效果显示在右栏，而按钮在中栏——不在卡片上给点反馈，
  // 老师会以为按钮没反应。busy 结束就清掉。
  const [varying, setVarying] = useState<string | null>(null)
  // 正在为哪道题配置变式（对话框开着）
  const [variantFor, setVariantFor] = useState<Problem | null>(null)
  if (!busy && varying) setVarying(null)

  if (!lesson) {
    return (
      <div className="placeholder">
        {/* 和标题栏、应用图标同一个记号。空状态是最占视觉的一屏，
            这里摆一个别的符号会让整个产品看起来没有统一的标识。 */}
        <div className="glyph" aria-hidden="true">
          <svg width="52" height="52" viewBox="0 0 100 100">
            <path
              d="M14 50 L32 78 L58 19 L87 19"
              fill="none"
              stroke="currentColor"
              strokeWidth="9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div>从左边选一个课时开始</div>
        <p className="hint">产物会落在课时文件夹里，不在这个软件的数据库里——你随时能直接打开、拷给同事。</p>
      </div>
    )
  }

  const { ok, blocked } = exportableProblems(lesson.problems)
  const tally = lesson.problems.reduce<Record<Status, number>>(
    (acc, p) => {
      const key: Status = p.verify?.status ?? 'unverified'
      acc[key] += 1
      return acc
    },
    { green: 0, yellow: 0, red: 0, unverified: 0 },
  )

  return (
    <>
      <div className="toolbar">
        <button
          className={tab === 'problems' ? 'tab active' : 'tab'}
          onClick={() => setTab('problems')}
        >
          problems.json
          <span className="count tabular">{lesson.problems.length}</span>
        </button>
        <button
          className={tab === 'homework' ? 'tab active' : 'tab'}
          onClick={() => setTab('homework')}
        >
          homework.md
        </button>

        <span className="spacer" />

        {ok.length > 0 && (
          <>
            <label className="opt" title="不勾选则只导出题面，适合直接印给学生">
              <input
                type="checkbox"
                checked={withAnswers}
                onChange={(e) => setWithAnswers(e.target.checked)}
              />
              含答案
            </label>
            <button
              className="export-btn"
              disabled={exporting}
              title={`导出 ${ok.length} 道题为 Word，公式可编辑`}
              onClick={() => {
                setExporting(true)
                setExportMsg(null)
                void api()
                  .exportDocx({ lessonId: lesson.meta.id, withAnswers })
                  .then((r) => {
                    if (r.canceled) return
                    setExportMsg(
                      r.ok
                        ? `已导出 ${r.exported} 道题` +
                            (r.blocked?.length ? `，拦下 ${r.blocked.length} 道` : '')
                        : `导出失败：${r.error ?? '未知原因'}`,
                    )
                  })
                  .finally(() => setExporting(false))
              }}
            >
              {exporting ? '导出中…' : '导出 Word'}
            </button>
          </>
        )}

      </div>

      {/* 汇总单独一条：工具栏里放不下（中栏只有 500 多像素，tab + 导出控件已经占满） */}
      {lesson.problems.length > 0 && (
        <div className="status-strip tabular">
          <span>
            可导出 <b>{ok.length}</b> / {lesson.problems.length}
          </span>
          <i className="divider" />
          {(['green', 'yellow', 'red', 'unverified'] as const)
            .filter((s) => tally[s] > 0)
            .map((s) => (
              <span className="tally-item" key={s}>
                <i className={`dot dot-${s}`} />
                {STATUS_LABEL[s]} {tally[s]}
              </span>
            ))}
        </div>
      )}

      {variantFor && (
        <VariantDialog
          problem={variantFor}
          onCancel={() => setVariantFor(null)}
          onConfirm={(prompt) => {
            setVarying(variantFor.id)
            setVariantFor(null)
            onVariant(prompt)
          }}
        />
      )}

      {exportMsg && (
        <div className="export-msg" onClick={() => setExportMsg(null)}>
          {exportMsg}
        </div>
      )}

      {blocked.length > 0 && (
        <div className="gate-warning">
          <strong>{blocked.length} 道题不会被导出</strong>
          <span>{blocked.map((b) => `${b.problem.id} ${b.reason}`).join('；')}</span>
        </div>
      )}

      <div className="artifact-body">
        <div className="artifact-inner">
          {tab === 'problems' ? (
            lesson.problems.length === 0 ? (
              <p className="empty">还没有题目。在右栏让 Agent 出一组。</p>
            ) : (
              lesson.problems.map((p, i) => (
              <ProblemCard
                key={p.id}
                problem={p}
                index={i + 1}
                lessonId={lesson.meta.id}
                busy={busy}
                varying={varying === p.id}
                onVariant={() => setVariantFor(p)}
                onDelete={() => onDelete(p.id)}
              />
            ))
            )
          ) : lesson.homework ? (
            <HomeworkView source={lesson.homework} />
          ) : (
            <p className="empty">还没有 homework.md。</p>
          )}
        </div>
      </div>
    </>
  )
}

function ProblemCard({
  problem,
  index,
  lessonId,
  busy,
  varying,
  onVariant,
  onDelete,
}: {
  problem: Problem
  index: number
  lessonId: string
  busy: boolean
  varying: boolean
  onVariant: () => void
  onDelete: () => void
}): ReactElement {
  const status: Status = problem.verify?.status ?? 'unverified'
  // 正确选项高亮。老师核对一道选择题时最想一眼看到的就是「哪个是答案」——
  // answer 字段是 "B" 一个字母，光看它还得回头去数选项。
  const correctOption = problem.check?.kind === 'choice' ? problem.check.correct : null
  // 绿的题不必默认摊开验算细节；黄红要让老师立刻看到为什么
  const [showPaths, setShowPaths] = useState(false)
  // 删除不可撤销，走两步确认。不用系统弹窗——那个太重，老师要连删几道时很烦。
  const [confirming, setConfirming] = useState(false)
  const [editing, setEditing] = useState(false)

  return (
    <article className={`problem status-${status}`}>
      <header>
        <span className="p-index">#{index}</span>
        <span className={`tier tier-${problem.tier}`}>{problem.tier}</span>
        <span className="p-type">{problem.type}</span>
        <span className="spacer" />
        <span className={`badge badge-${status}`}>
          <i className={`dot dot-${status}`} />
          {STATUS_LABEL[status]}
        </span>
      </header>

      {/* 题干里的 ![](...) 是给导出用的定位标记，界面上由 Figure 单独渲染，
          留在文本里会以「![](assets/bar1.svg)」的字面形式突兀地显示出来 */}
      <div className="stem">
        <Math>{stripImages(problem.stem)}</Math>
      </div>

      {problem.options && Object.keys(problem.options).length > 0 && (
        <ol className="options">
          {Object.entries(problem.options)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, text]) => (
              <li key={key} className={key === correctOption ? 'opt-row correct' : 'opt-row'}>
                <span className="opt-key">{key}</span>
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

      {problem.solution.length > 0 && (
        <ol className="solution">
          {problem.solution.map((step, i) => (
            <li key={i}>
              <Math>{step}</Math>
            </li>
          ))}
        </ol>
      )}

      {problem.verify && problem.verify.status !== 'green' && problem.verify.log && (
        <div className="verify-log">{problem.verify.log}</div>
      )}

      {problem.verify && problem.verify.paths.length > 0 && (
        <>
          <button
            className="paths-toggle"
            aria-expanded={showPaths}
            onClick={() => setShowPaths((v) => !v)}
          >
            <span className="chev">▶</span>
            {showPaths ? '收起验算过程' : `验算过程（${problem.verify.paths.length} 条路径）`}
          </button>
          {showPaths && (
            <ul className="paths">
              {problem.verify.paths.map((p) => (
                <li key={p.name} className={p.ok ? 'path ok' : 'path bad'}>
                  <code>{p.name}</code>
                  <span>{p.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <footer className="p-actions">
        <button
          className="p-act"
          disabled={busy}
          title="题干、答案、解析、分层都能改；保存时会重新验算"
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? '收起编辑' : '编辑'}
        </button>
        <button
          className={varying ? 'p-act working-act' : 'p-act'}
          disabled={busy}
          title={
            busy && !varying
              ? '正在处理上一轮，稍等'
              : '让 Agent 按这道题的结构再出几道，换数字换问法'
          }
          onClick={onVariant}
        >
          {varying ? '生成变式中…' : '出变式'}
        </button>
        {confirming ? (
          <>
            <button className="p-act danger" onClick={onDelete}>
              确认删除
            </button>
            <button className="p-act" onClick={() => setConfirming(false)}>
              取消
            </button>
          </>
        ) : (
          <button className="p-act" title="从这份卷子里剔除" onClick={() => setConfirming(true)}>
            删除
          </button>
        )}
      </footer>

      {editing && (
        <ProblemEditor
          problem={problem}
          lessonId={lessonId}
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      )}
    </article>
  )
}
