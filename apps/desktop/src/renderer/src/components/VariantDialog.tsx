import { useEffect, useState, type ReactElement } from 'react'
import type { Problem } from '@mtc/shared'
import { Math } from './Math.js'

/**
 * 出变式之前先问清楚要什么。
 *
 * 原来点一下就直接发一句写死的提示词，没有确认、没法补充要求。老师点完只看到
 * 右栏开始滚事件，既不知道会出几道、也不知道变哪里——[claude.md](docs/claude.md) §4
 * 把「变式生成器」列为最高价值的功能，它不该是一个盲盒按钮。
 *
 * 变式的几个方向来自同一节：同源题 / 改数 / 改问法 / 逆向命题 / 一题多解。
 */

const DIRECTIONS = [
  { key: 'numbers', label: '换数字', hint: '结构完全不变，只换系数' },
  { key: 'ask', label: '换问法', hint: '同一情境，改问要求的量' },
  { key: 'reverse', label: '逆向命题', hint: '已知与所求对调' },
  { key: 'multi', label: '一题多解', hint: '同一道题给出不同解法' },
  { key: 'trap', label: '踩常见错因', hint: '刻意设计成会犯典型错误的形式' },
] as const

type DirectionKey = (typeof DIRECTIONS)[number]['key']

export function VariantDialog({
  problem,
  onConfirm,
  onCancel,
}: {
  problem: Problem
  onConfirm: (prompt: string) => void
  onCancel: () => void
}): ReactElement {
  const [count, setCount] = useState(2)
  const [dirs, setDirs] = useState<Set<DirectionKey>>(new Set(['numbers']))
  const [tier, setTier] = useState<'same' | 'A' | 'B' | 'C'>('same')
  const [extra, setExtra] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const toggle = (k: DirectionKey): void =>
    setDirs((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })

  const buildPrompt = (): string => {
    const chosen = DIRECTIONS.filter((d) => dirs.has(d.key))
    const lines = [
      `按第「${problem.id}」题出 ${count} 道同源变式。`,
      `原题（${problem.tier} 层，${problem.type}）：${problem.stem}`,
      `原答案：${problem.answer}`,
      '',
      '变式方向：' +
        (chosen.length > 0
          ? chosen.map((d) => `${d.label}（${d.hint}）`).join('、')
          : '换数字（结构完全不变，只换系数）'),
      tier === 'same' ? `分层保持 ${problem.tier} 层。` : `分层做成 ${tier} 层。`,
    ]
    if (problem.variantSeed?.constraints?.length) {
      lines.push(`必须保持这些约束：${problem.variantSeed.constraints.join('；')}`)
    }
    if (extra.trim()) lines.push(`老师补充：${extra.trim()}`)
    lines.push(
      '',
      '考点必须和原题一致，不要换知识点。',
      '用 save_problems 的 mode="append" 追加，id 取新的，不要动原题。',
    )
    return lines.join('\n')
  }

  return (
    <div className="modal" onClick={onCancel} role="dialog" aria-modal="true">
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">出变式</h3>

        <div className="vd-origin">
          <span className="vd-origin-label">原题</span>
          <div className="vd-origin-stem">
            <Math>{problem.stem.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim()}</Math>
          </div>
        </div>

        <label className="ed-row">
          <span className="ed-label">出几道</span>
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} 道
              </option>
            ))}
          </select>
        </label>

        <div className="ed-row">
          <span className="ed-label">变什么</span>
          <div className="vd-dirs">
            {DIRECTIONS.map((d) => (
              <button
                key={d.key}
                className={dirs.has(d.key) ? 'vd-dir on' : 'vd-dir'}
                title={d.hint}
                onClick={() => toggle(d.key)}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <label className="ed-row">
          <span className="ed-label">分层</span>
          <select value={tier} onChange={(e) => setTier(e.target.value as typeof tier)}>
            <option value="same">和原题一样（{problem.tier} 层）</option>
            <option value="A">A 基础</option>
            <option value="B">B 提升</option>
            <option value="C">C 拓展</option>
          </select>
        </label>

        <label className="ed-row">
          <span className="ed-label">补充</span>
          <textarea
            rows={2}
            value={extra}
            placeholder="比如：系数不要超过 10；结合实际情境；避免出现负数解"
            onChange={(e) => setExtra(e.target.value)}
          />
        </label>

        {problem.variantSeed?.constraints?.length ? (
          <p className="ed-note">
            会自动带上原题的约束：{problem.variantSeed.constraints.join('；')}
          </p>
        ) : (
          <p className="ed-note">这道题没有存变式种子，只能按题面推断结构。</p>
        )}

        <div className="ed-actions">
          <span className="ed-hint">新题会追加在后面，原题不动</span>
          <button className="p-act" onClick={onCancel}>
            取消
          </button>
          <button className="primary-btn" onClick={() => onConfirm(buildPrompt())}>
            开始生成
          </button>
        </div>
      </div>
    </div>
  )
}
