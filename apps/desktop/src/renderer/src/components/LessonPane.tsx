import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
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

/** 搜索词：按空白切开、去空、转小写。多个词要同时命中（「函数 图象」比「函数」窄） */
function termsOf(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

/**
 * 按关键字裁剪教材树。
 *
 * 只有一条规则：**知识点**拿「教材 年级 各级章节名 知识点名 内容摘要」拼起来去比，
 * 所有词都命中才留下；章节留下与否只看它底下还剩没剩知识点。
 * 于是搜章名会留下整章，搜知识点只留那几个，搜「七年级 方程」会落到七年级的方程章——
 * 不用给「章名命中」「知识点命中」各写一套。
 */
function filterNodes(nodes: CurriculumNode[], terms: string[], context: string): CurriculumNode[] {
  const out: CurriculumNode[] = []
  for (const n of nodes) {
    const here = `${context} ${n.title}`
    const kps = (n.knowledgePoints ?? []).filter((k) => {
      const hay = `${here} ${k.title} ${k.desc ?? ''}`.toLowerCase()
      return terms.every((t) => hay.includes(t))
    })
    const children = filterNodes(n.children ?? [], terms, here)
    if (kps.length > 0 || children.length > 0) {
      out.push({ ...n, knowledgePoints: kps, children })
    }
  }
  return out
}

/** 把命中的词标出来。教材树很密，不标的话老师得自己在每行里找为什么它被留下 */
function highlight(text: string, terms: string[]): ReactNode {
  if (terms.length === 0) return text
  const lower = text.toLowerCase()
  const marks: boolean[] = new Array(text.length).fill(false)
  for (const t of terms) {
    for (let i = lower.indexOf(t); i !== -1; i = lower.indexOf(t, i + 1)) {
      for (let j = i; j < i + t.length; j++) marks[j] = true
    }
  }
  const parts: ReactNode[] = []
  let i = 0
  while (i < text.length) {
    let j = i
    while (j < text.length && marks[j] === marks[i]) j++
    const seg = text.slice(i, j)
    parts.push(marks[i] ? <mark key={i}>{seg}</mark> : seg)
    i = j
  }
  return parts
}

/**
 * 左栏分两段，上教材下课时。
 *
 * **教材在上**：它是「去哪儿开始」的入口，整段默认折叠——一版六册也有一百多个
 * 知识点，摊开是一堵墙，而老师一学期就用一两章。只显示设置里选的那一版。
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
  const [query, setQuery] = useState('')
  const terms = useMemo(() => termsOf(query), [query])
  const searching = terms.length > 0

  // 搜索时整棵树按关键字裁剪；没有搜索词就原样
  const shown = useMemo(() => {
    if (!searching) return curricula
    return curricula
      .map((c) => ({ ...c, nodes: filterNodes(c.nodes, terms, `${c.textbook} ${c.grade}`) }))
      .filter((c) => c.nodes.length > 0)
  }, [curricula, terms, searching])
  const hits = useMemo(
    () => shown.reduce((n, c) => n + allKnowledgePoints(c.nodes).length, 0),
    [shown],
  )

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
        {/* 搜索框在滚动区外面：往下翻的时候它不该被卷走 */}
        {booksOpen && curricula.length > 0 && (
          <div className="tree-search">
            <input
              type="search"
              value={query}
              placeholder="搜知识点或章节，如「一元二次」「七年级 方程」"
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('')
              }}
            />
            {searching && (
              <span className="tree-search-count tabular">{hits} 个</span>
            )}
          </div>
        )}
        {booksOpen && (
          <div className="section-body">
            {curricula.length === 0 && <p className="empty">curriculum/ 下没有教材数据</p>}
            {searching && shown.length === 0 && (
              <p className="empty">没有匹配「{query.trim()}」的知识点</p>
            )}
            {shown.map((c) => {
              const key = `${c.textbook}|${c.grade}`
              // 搜索时把命中的全摊开：结果本来就少，再让老师一层层点开就白搜了
              const open = searching || openBooks.has(key)
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
                          terms={terms}
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
  /** 搜索词。非空时强制展开并高亮命中处 */
  terms: string[]
  onPick: (kp: KnowledgePoint, chapterTitle: string) => void
}

function ChapterNode({ node, chapterTitle, existing, terms, onPick }: ChapterProps): ReactElement {
  const [userOpen, setOpen] = useState(false)
  const open = terms.length > 0 || userOpen
  const kps = node.knowledgePoints ?? []
  const children = node.children ?? []

  return (
    <div className="chapter">
      <button className="chapter-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="chev">▶</span>
        <span className="chapter-name" title={node.desc ?? ''}>
          {highlight(node.title, terms)}
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
              terms={terms}
              onPick={() => onPick(k, chapterTitle)}
            />
          ))}
          {children.map((c) => (
            <ChapterNode
              key={c.id}
              node={c}
              chapterTitle={chapterTitle}
              existing={existing}
              terms={terms}
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
  terms,
  onPick,
}: {
  kp: KnowledgePoint
  hasLesson: boolean
  terms: string[]
  onPick: () => void
}): ReactElement {
  const tip = [kp.desc, kp.standard, hasLesson ? '已有课时，点击打开' : '点击建一个课时']
    .filter(Boolean)
    .join('\n')
  return (
    <button className="tree-kp" title={tip} onClick={onPick}>
      {hasLesson && <span className="kp-has" title="已有课时" />}
      <span className="kp-title">{highlight(kp.title, terms)}</span>
      {kp.examWeight === 'high' && <span className="kp-hot" title="中考高频" />}
      {kp.commonErrors.length > 0 && (
        <span className="kp-err tabular" title={`常见错因：\n${kp.commonErrors.join('\n')}`}>
          {kp.commonErrors.length}
        </span>
      )}
    </button>
  )
}
