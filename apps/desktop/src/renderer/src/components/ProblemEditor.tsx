import { useState, type ReactElement } from 'react'
import type { Problem, ProblemCheck, ProblemType, Tier } from '@mtc/shared'
import { api } from '../devFixture.js'

/**
 * 就地编辑一道题。
 *
 * docs/claude.md 第五节：「产物必须可编辑。教师一定会改；改动本身就是最好的偏好信号。」
 *
 * **保存时会重新验算**，这条不能省。老师把答案从 2 改成 3，那个绿色的
 * 「已验证」就变成了谎言，而它还是可导出的——等于产品在替一道错题背书。
 * 所以保存走的是和 Agent 完全一样的闸门：按 check 规格实跑，验不过就不保存、
 * 原题原样留着。
 *
 * 验算规格也开放给老师改：他改了答案，就得同时告诉机器「现在该验什么」。
 * 这看起来技术，但它恰恰是这个产品最该让老师看见的东西——凭什么说这题是对的。
 */
export function ProblemEditor({
  problem,
  lessonId,
  onDone,
  onCancel,
}: {
  problem: Problem
  lessonId: string
  onDone: () => void
  onCancel: () => void
}): ReactElement {
  const [stem, setStem] = useState(problem.stem)
  const [answer, setAnswer] = useState(problem.answer)
  const [solution, setSolution] = useState(problem.solution.join('\n'))
  const [tier, setTier] = useState<Tier>(problem.tier)
  // 题型必须能改：闸门要求 type="选择" 和 check.kind="choice" 一一对应，
  // 只能改 check 不能改 type 的话，在这里选「选择题」保存必然失败。
  const [type, setType] = useState<ProblemType>(problem.type)
  const [options, setOptions] = useState<Record<string, string>>(problem.options ?? {})
  const [check, setCheck] = useState<ProblemCheck>(() => {
    // 老选择题的 check 是 manual（或者压根没有），而闸门现在要求 choice。
    // 直接给它落在 choice 形态上：老师一打开就看到「从题干提取选项」按钮，
    // 一键就迁移完了。否则他改一个字保存，被要求重建整个验算规格，多半就不改了。
    if (problem.type === '选择' && problem.check?.kind !== 'choice') {
      return {
        kind: 'choice',
        correct: /^[A-F]$/.test(problem.answer.trim()) ? problem.answer.trim() : 'A',
        basis: problem.check?.kind === 'manual'
          ? problem.check
          : { kind: 'manual', reason: '' },
      }
    }
    return problem.check ?? { kind: 'manual', reason: '这道题没有验算规格，需教师自行确认' }
  })
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  const save = (): void => {
    setSaving(true)
    setErrors([])
    const edited: Problem = {
      ...problem,
      stem: stem.trim(),
      answer: answer.trim(),
      solution: solution
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
      tier,
      type,
      check,
      options: Object.keys(options).length > 0 ? options : undefined,
    }
    void api()
      .updateProblem(lessonId, edited)
      .then((r) => {
        if (r.ok) {
          onDone()
          return
        }
        // 验算不过时把原因原样给老师看——他多半是改了答案但忘了同步验算规格
        setErrors([
          ...(r.errors ?? []),
          ...(r.rejected ?? []).map((x) => `验算不通过，原题已保留：${x.reason}`),
        ])
      })
      .catch((e: unknown) => setErrors([String(e)]))
      .finally(() => setSaving(false))
  }

  return (
    <div className="editor">
      <label className="ed-row">
        <span className="ed-label">题干</span>
        <textarea rows={3} value={stem} onChange={(e) => setStem(e.target.value)} />
      </label>

      <label className="ed-row">
        <span className="ed-label">答案</span>
        <input value={answer} onChange={(e) => setAnswer(e.target.value)} />
      </label>

      <label className="ed-row">
        <span className="ed-label">解析</span>
        <textarea
          rows={4}
          value={solution}
          placeholder="一行一步"
          onChange={(e) => setSolution(e.target.value)}
        />
      </label>

      <label className="ed-row">
        <span className="ed-label">分层</span>
        <select value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
          <option value="A">A 基础</option>
          <option value="B">B 提升</option>
          <option value="C">C 拓展</option>
        </select>
      </label>

      <label className="ed-row">
        <span className="ed-label">题型</span>
        <select
          value={type}
          onChange={(e) => {
            const t = e.target.value as ProblemType
            setType(t)
            // 题型和验算方式是绑定的，改了题型就把 check 带过去，
            // 否则老师得再去下面那个下拉框改一次，忘了就保存失败
            if (t === '选择' && check.kind !== 'choice') {
              setCheck({ kind: 'choice', correct: 'A', basis: { kind: 'manual', reason: '' } })
            } else if (t !== '选择' && check.kind === 'choice') {
              setCheck({ kind: 'manual', reason: '' })
            }
          }}
        >
          <option value="选择">选择</option>
          <option value="填空">填空</option>
          <option value="解答">解答</option>
          <option value="证明">证明</option>
          <option value="作图">作图</option>
        </select>
      </label>

      {check.kind === 'choice' && (
        <OptionsEditor
          options={options}
          stem={stem}
          onChange={setOptions}
          onStemChange={setStem}
        />
      )}

      <CheckEditor
        check={check}
        onChange={setCheck}
        optionKeys={Object.keys(options).sort()}
      />

      {errors.length > 0 && (
        <ul className="ed-errors">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      <div className="ed-actions">
        <span className="ed-hint">保存时会按验算规格重新验一遍，不通过则保留原题</span>
        <button className="p-act" onClick={onCancel} disabled={saving}>
          取消
        </button>
        <button className="primary-btn" onClick={save} disabled={saving}>
          {saving ? '验算中…' : '保存并验算'}
        </button>
      </div>
    </div>
  )
}

/** 选项号后面跟内容，形如 "A. "、"B、"、"C）"。用来从老数据的题干里把选项拆出来。 */
const OPT_MARK = /(?:^|[\s（(　])([A-D])\s*[.、．)）]\s*/g

/**
 * 从题干里把选项拆出来。
 *
 * 早期的选择题把选项写在题干字符串里（"…（　　）\n\nA. 1　B. 2　C. 3　D. 4"）。
 * 现在闸门要求选项放在 options 字段——不给这个按钮，老师改一道老选择题就得
 * 手动敲四遍选项，那他多半就不改了，数据永远迁不过来。
 */
function parseOptionsFromStem(
  stem: string,
): { options: Record<string, string>; stem: string } | null {
  const marks = [...stem.matchAll(OPT_MARK)]
  if (marks.length < 2) return null
  const options: Record<string, string> = {}
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i]!
    const from = m.index! + m[0].length
    const to = i + 1 < marks.length ? marks[i + 1]!.index! : stem.length
    const text = stem.slice(from, to).trim()
    if (!text) return null
    options[m[1]!] = text
  }
  return { options, stem: stem.slice(0, marks[0]!.index!).trim() }
}

/** 选项编辑。键固定 A–D 的顺序，值可以是 LaTeX。 */
function OptionsEditor({
  options,
  stem,
  onChange,
  onStemChange,
}: {
  options: Record<string, string>
  stem: string
  onChange: (o: Record<string, string>) => void
  onStemChange: (s: string) => void
}): ReactElement {
  const keys = Object.keys(options).sort()
  const extracted = keys.length === 0 ? parseOptionsFromStem(stem) : null
  return (
    <div className="ed-check">
      <div className="ed-check-head">
        <span className="ed-label">选项</span>
        {extracted && (
          <button
            className="p-act"
            title="这道题的选项还写在题干里，点一下搬到 options 字段"
            onClick={() => {
              onChange(extracted.options)
              onStemChange(extracted.stem)
            }}
          >
            从题干提取 {Object.keys(extracted.options).length} 个选项
          </button>
        )}
      </div>
      {keys.length === 0 ? (
        <p className="ed-note">
          选择题必须有选项，且不能只写在题干里——写在题干里就没法逐项验证「有且仅有一个正确选项」。
        </p>
      ) : (
        keys.map((k) => (
          <label className="ed-row" key={k}>
            <span className="ed-label">{k}</span>
            <input
              value={options[k]}
              onChange={(e) => onChange({ ...options, [k]: e.target.value })}
            />
          </label>
        ))
      )}
      <div className="ed-actions">
        <span className="ed-hint">选项不要再写进题干，否则会被拒收</span>
        {keys.length > 2 && (
          <button
            className="p-act"
            onClick={() => {
              const next = { ...options }
              delete next[keys[keys.length - 1]!]
              onChange(next)
            }}
          >
            删末项
          </button>
        )}
        {keys.length < 6 && (
          <button
            className="p-act"
            onClick={() =>
              onChange({ ...options, [String.fromCharCode(65 + keys.length)]: '' })
            }
          >
            加一项
          </button>
        )}
      </div>
    </div>
  )
}

/** 换一种 check 类型时给出该类型的空壳。 */
function blankCheck(kind: string): ProblemCheck {
  if (kind === 'solve') return { kind, equation: '', variable: 'x', claimed_roots: [] }
  if (kind === 'identity') return { kind, left: '', right: '' }
  if (kind === 'evaluate') return { kind, expression: '', substitutions: {}, claimed: '' }
  if (kind === 'choice') {
    return { kind, correct: 'A', basis: { kind: 'manual', reason: '' } }
  }
  return { kind: 'manual', reason: '' }
}

/** 验算规格。老师改了答案就必须同步改这里，否则保存时会被验算拦下。 */
function CheckEditor({
  check,
  onChange,
  optionKeys,
}: {
  check: ProblemCheck
  onChange: (c: ProblemCheck) => void
  /** 选择题的选项号，用来限制「哪个是正确选项」只能选真实存在的 */
  optionKeys: string[]
}): ReactElement {
  return (
    <div className="ed-check">
      <div className="ed-check-head">
        <span className="ed-label">机器怎么验这道题</span>
        <select value={check.kind} onChange={(e) => onChange(blankCheck(e.target.value))}>
          <option value="solve">解方程</option>
          <option value="identity">恒等变形</option>
          <option value="evaluate">求值</option>
          <option value="choice">选择题</option>
          <option value="manual">人工确认（几何 / 证明 / 开放题）</option>
        </select>
      </div>

      {check.kind === 'choice' && (
        <>
          <label className="ed-row">
            <span className="ed-label">正确选项</span>
            <select
              value={check.correct}
              onChange={(e) => onChange({ ...check, correct: e.target.value })}
            >
              {/* 下拉里必须始终包含当前状态值。选项还没提取出来时 optionKeys 是空的，
                  少了这一步 select 会退回显示第一项，屏幕上写着 A 而状态里是 B——
                  老师看到的和将要保存的不是一回事。 */}
              {[...new Set([...optionKeys, check.correct].filter(Boolean))].sort().map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <div className="ed-check-head">
            <span className="ed-label">正确答案怎么算出来</span>
            <select
              value={check.basis.kind}
              onChange={(e) => {
                const b = blankCheck(e.target.value)
                if (b.kind === 'choice') return
                onChange({ ...check, basis: b })
              }}
            >
              <option value="solve">解方程</option>
              <option value="identity">恒等变形</option>
              <option value="evaluate">求值</option>
              <option value="manual">判不了，人工确认</option>
            </select>
          </div>
          {/* 干扰项的排除也按这个依据实算，所以依据给得越具体，这道题越可能变绿 */}
          <CheckFields
            check={check.basis}
            onChange={(b) => {
              if (b.kind === 'choice') return
              onChange({ ...check, basis: b })
            }}
          />
          <p className="ed-note">
            {check.basis.kind === 'manual'
              ? '人工确认的依据只能验到「选项两两互异」，结果是黄色。给出代数依据才能变绿。'
              : '会逐项实算：正确选项确实成立、其余选项确实都不成立。两个选项都对会被拒收。'}
          </p>
        </>
      )}

      {check.kind !== 'choice' && <CheckFields check={check} onChange={onChange} />}
    </div>
  )
}

/** 各类型自己的字段。单独抽出来是因为选择题的 basis 要复用同一套。 */
function CheckFields({
  check,
  onChange,
}: {
  check: ProblemCheck
  onChange: (c: ProblemCheck) => void
}): ReactElement {
  return (
    <>
      {check.kind === 'solve' && (
        <>
          <label className="ed-row">
            <span className="ed-label">方程</span>
            <input
              value={check.equation}
              placeholder="x^2 - 5*x + 6 = 0"
              onChange={(e) => onChange({ ...check, equation: e.target.value })}
            />
          </label>
          <label className="ed-row">
            <span className="ed-label">根</span>
            <input
              value={check.claimed_roots.join(', ')}
              placeholder="2, 3"
              onChange={(e) =>
                onChange({
                  ...check,
                  claimed_roots: e.target.value
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
        </>
      )}

      {check.kind === 'identity' && (
        <>
          <label className="ed-row">
            <span className="ed-label">左边</span>
            <input
              value={check.left}
              onChange={(e) => onChange({ ...check, left: e.target.value })}
            />
          </label>
          <label className="ed-row">
            <span className="ed-label">右边</span>
            <input
              value={check.right}
              onChange={(e) => onChange({ ...check, right: e.target.value })}
            />
          </label>
        </>
      )}

      {check.kind === 'evaluate' && (
        <>
          <label className="ed-row">
            <span className="ed-label">表达式</span>
            <input
              value={check.expression}
              onChange={(e) => onChange({ ...check, expression: e.target.value })}
            />
          </label>
          <label className="ed-row">
            <span className="ed-label">结果</span>
            <input
              value={check.claimed}
              onChange={(e) => onChange({ ...check, claimed: e.target.value })}
            />
          </label>
        </>
      )}

      {check.kind === 'manual' && (
        <label className="ed-row">
          <span className="ed-label">理由</span>
          <input
            value={check.reason}
            placeholder="为什么机器验不了，希望你重点确认哪里"
            onChange={(e) => onChange({ ...check, reason: e.target.value })}
          />
        </label>
      )}
      {check.kind === 'manual' && (
        <p className="ed-note">
          人工确认的题是黄色，只能你自己预览，不会印进发给学生的卷子。
          证明题、几何题走这条是正常的，不是降级。
        </p>
      )}
    </>
  )
}
