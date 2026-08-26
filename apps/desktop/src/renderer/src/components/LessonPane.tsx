import { useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  allKnowledgePoints,
  type Curriculum,
  type CurriculumNode,
  type KnowledgePoint,
  type LessonMeta,
} from '@mtc/shared'

interface Props {
  curricula: Curriculum[]
  lessons: LessonMeta[]
  currentId: string | null
  /** 正在跑 Agent 的课时。老师会一边等一边去看别的课时，状态得挂在对的那一条上。 */
  busyLesson: string | null
  currentTextbook: string | null
  currentGrade: string | null
  onOpen: (id: string) => void
  /** 点教材树上的知识点：没有课时就建一个，有就直接打开 */
  onPickKnowledgePoint: (
    textbook: string,
    grade: string,
    chapterTitle: string,
    kp: KnowledgePoint,
  ) => void
}

/**
 * 左栏分两段，上教材下课时。
 *
 * **教材在上**：它是「去哪儿开始」的入口，整段默认折叠——两版全六册 255 个
 * 知识点，摊开是一堵墙，而老师一学期就用一两章。
 *
 * **课时在下，按最近改动倒序**：这是他真正天天点的东西。倒序的理由很实——
 * 备课是连续的，昨天在弄哪一节，今天多半接着弄；按名字排会把它冲到列表中间。
 */
export function LessonPane({
  curricula,
  lessons,
  currentId,
  busyLesson,
  currentTextbook,
  currentGrade,
  onOpen,
  onPickKnowledgePoint,
}: Props): ReactElement {
  const [booksOpen, setBooksOpen] = useState(false)
  const [openBooks, setOpenBooks] = useState<Set<string>>(new Set())

  // 打开某个课时时，自动展开它所属的那一册（但不自动掀开整个教材区）
  useEffect(() => {
    if (!currentTextbook || !currentGrade) return
    setOpenBooks((prev) => new Set(prev).add(`${currentTextbook}|${currentGrade}`))
  }, [currentTextbook, currentGrade])

  // 已经建过课时的知识点，在树上标出来，免得老师重复点
  const existing = useMemo(() => new Set(lessons.flatMap((l) => l.standardRefs)), [lessons])

  /** 最近改动的排前面。时间戳坏了的排最后，不要让它顶到第一位。 */
  const recent = useMemo(() => {
    const ts = (l: LessonMeta): number => {
      const t = Date.parse(l.updatedAt)
      return Number.isNaN(t) ? 0 : t
    }
    return [...lessons].sort((a, b) => ts(b) - ts(a))
  }, [lessons])

  const toggleBook = (key: string): void =>
    setOpenBooks((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const totalKp = useMemo(
    () => curricula.reduce((n, c) => n + allKnowledgePoints(c.nodes).length, 0),
    [curricula],
  )

  return (
    <>
      <section className="pane-section">
        <button
          className="section-head"
          aria-expanded={booksOpen}
          onClick={() => setBooksOpen((v) => !v)}
        >
          <span className="chev">▶</span>
          <span className="section-title">教材</span>
          <span className="section-count tabular">
            {curricula.length} 套 · {totalKp}
          </span>
        </button>
        {booksOpen && (
          <div className="section-body">
            {curricula.length === 0 && <p className="empty">curriculum/ 下没有教材数据</p>}
            {curricula.map((c) => {
              const key = `${c.textbook}|${c.grade}`
              const open = openBooks.has(key)
              return (
                <div key={key} className="book">
                  <button
                    className="book-head"
                    aria-expanded={open}
                    onClick={() => toggleBook(key)}
                    title={c.source ?? ''}
                  >
                    <span className="chev">▶</span>
                    <span className="book-name">
                      {c.textbook}
                      <span className="book-grade">{c.grade}</span>
                    </span>
                    <span className="book-count tabular">
                      {allKnowledgePoints(c.nodes).length}
                    </span>
                  </button>
                  {open && (
                    <div className="book-body">
                      {c.nodes.map((n) => (
                        <ChapterNode
                          key={n.id}
                          node={n}
                          chapterTitle={n.title}
                          existing={existing}
                          onPick={(kp, chapterTitle) =>
                            onPickKnowledgePoint(c.textbook, c.grade, chapterTitle, kp)
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="pane-section grow">
        <h2 className="pane-title">我的课时</h2>
        {recent.length === 0 && (
          <p className="empty">
            还没有课时。展开上面的「教材」，点一个知识点就能建一节。
          </p>
        )}
        <ul className="lesson-list">
          {recent.map((l) => (
            <li key={l.id}>
              <button
                className={l.id === currentId ? 'lesson active' : 'lesson'}
                onClick={() => onOpen(l.id)}
                title={l.id}
              >
                <span className="lesson-row">
                  <span className="lesson-name">{l.lesson}</span>
                  {l.id === busyLesson ? (
                    <span className="lesson-status st-busy">
                      <i className="pulse" />
                      生成中
                    </span>
                  ) : (
                    <span className={`lesson-status st-${statusKey(l.status)}`}>{l.status}</span>
                  )}
                </span>
                <span className="lesson-meta">
                  {l.textbook}
                  {l.grade} · {l.chapter}
                </span>
                <span className="lesson-time">{relativeTime(l.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

function statusKey(status: string): string {
  return status === '已定稿' ? 'done' : status === '备课中' ? 'wip' : 'new'
}

/** 「3 小时前」这种。老师扫列表时看相对时间比看日期快。 */
function relativeTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const min = Math.floor(diff / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  return new Date(t).toLocaleDateString('zh-CN')
}

interface ChapterProps {
  node: CurriculumNode
  /** 建课时用的章名。三层结构时沿用最外层的章，不用中间的节名 */
  chapterTitle: string
  existing: Set<string>
  onPick: (kp: KnowledgePoint, chapterTitle: string) => void
}

function ChapterNode({ node, chapterTitle, existing, onPick }: ChapterProps): ReactElement {
  const [open, setOpen] = useState(false)
  const kps = node.knowledgePoints ?? []
  const children = node.children ?? []

  return (
    <div className="chapter">
      <button className="chapter-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="chev">▶</span>
        <span className="chapter-name" title={node.desc ?? ''}>
          {node.title}
        </span>
        {node.examWeight === 'high' && (
          <span className="hot" title="中考高频">
            高频
          </span>
        )}
        <span className="chapter-count tabular">
          {kps.length + allKnowledgePoints(children).length}
        </span>
      </button>
      {open && (
        <div className="chapter-body">
          {kps.map((k) => (
            <KnowledgePointRow
              key={k.id}
              kp={k}
              hasLesson={existing.has(k.id)}
              onPick={() => onPick(k, chapterTitle)}
            />
          ))}
          {children.map((c) => (
            <ChapterNode
              key={c.id}
              node={c}
              chapterTitle={chapterTitle}
              existing={existing}
              onPick={onPick}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function KnowledgePointRow({
  kp,
  hasLesson,
  onPick,
}: {
  kp: KnowledgePoint
  hasLesson: boolean
  onPick: () => void
}): ReactElement {
  const tip = [kp.desc, kp.standard, hasLesson ? '已有课时，点击打开' : '点击建一个课时']
    .filter(Boolean)
    .join('\n')
  return (
    <button className="tree-kp" title={tip} onClick={onPick}>
      {hasLesson && <span className="kp-has" title="已有课时" />}
      <span className="kp-title">{kp.title}</span>
      {kp.examWeight === 'high' && <span className="kp-hot" title="中考高频" />}
      {kp.commonErrors.length > 0 && (
        <span className="kp-err tabular" title={`常见错因：\n${kp.commonErrors.join('\n')}`}>
          {kp.commonErrors.length}
        </span>
      )}
    </button>
  )
}
