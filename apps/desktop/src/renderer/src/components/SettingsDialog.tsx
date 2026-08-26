import { useEffect, useState, type ReactElement } from 'react'
import {
  settingsWarnings,
  type EffectiveSettings,
  type ImageModelList,
  type LlmSettings,
  type LlmTestResult,
  type SettingsSource,
} from '@mtc/shared'
import { api } from '../devFixture.js'

/**
 * 模型接入设置。
 *
 * 打包成客户端后 `.env` 就不存在了，老师也不会去改环境变量——必须有个界面能填。
 *
 * 三件事是刻意做的：
 *
 * 1. **显示每一项的来源。** 优先级是「设置 > .env > 环境变量」，反直觉，
 *    而且看不见的时候会造出「我明明改了怎么没生效」这类查不动的困惑。
 * 2. **能真打一次。** 地址少一段、别名在网关上不存在、密钥过期——三种都只在
 *    真正出题时才暴露，那时候老师已经等了几分钟，报出来的错还完全指不到这里。
 * 3. **把往返耗时报出来。** 这个网关实测有 1.2~10.6 秒的每请求固定开销
 *    （见 architecture.md §4.15）。测出 8 秒，老师就知道后面出一组题会慢，
 *    而不是以为软件卡死了。
 * 4. **图模型能列出来点，不用背。** 名字长这样：`codex/gpt-5.6-luna`，
 *    没人猜得到；填错的唯一症状是四十秒后一个 400，那时候老师正等着插图。
 *    列一次是免费的 GET，不出图。
 */

const SOURCE_LABEL: Record<SettingsSource, string> = {
  settings: '本页设置',
  dotenv: '.env 文件',
  env: '环境变量',
  default: '默认值',
  none: '未设置',
}

function SourceTag({ from }: { from: SettingsSource }): ReactElement | null {
  // 「来自本页设置」是常态，不必每行都标；其余几种才需要解释
  if (from === 'settings') return null
  const text = from === 'none' ? SOURCE_LABEL[from] : `来自${SOURCE_LABEL[from]}`
  return <span className={`src-tag src-${from}`}>{text}</span>
}

export function SettingsDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void
  /** 保存成功后把最新的生效配置交出去，让外面更新「未配置」的提示 */
  onSaved: (e: EffectiveSettings) => void
}): ReactElement {
  const [loaded, setLoaded] = useState<EffectiveSettings | null>(null)
  const [form, setForm] = useState<LlmSettings>({
    baseUrl: '',
    apiKey: '',
    model: '',
    imageModel: '',
  })
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<LlmTestResult | null>(null)
  const [listing, setListing] = useState(false)
  const [imageModels, setImageModels] = useState<ImageModelList | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api()
      .getSettings()
      .then((e) => {
        setLoaded(e)
        setForm(e.settings)
      })
      .catch((err: unknown) => setError(String(err)))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = (patch: Partial<LlmSettings>): void => {
    setForm((f) => ({ ...f, ...patch }))
    // 改了任何一项，上一次的测试结果就不再代表当前填的内容了
    setTest(null)
    setSavedAt(null)
    // 但图模型清单只取决于地址和密钥。改别的项还清掉它的话，
    // 点一下清单里的名字，清单自己就消失了——正好在他要用的时候
    if ('baseUrl' in patch || 'apiKey' in patch) setImageModels(null)
  }

  const warnings = settingsWarnings(form)

  const doTest = (): void => {
    setTesting(true)
    setTest(null)
    void api()
      .testLlm(form)
      .then(setTest)
      .catch((e: unknown) => setTest({ ok: false, detail: String(e) }))
      .finally(() => setTesting(false))
  }

  const doListImageModels = (): void => {
    setListing(true)
    setImageModels(null)
    void api()
      .listImageModels(form)
      .then(setImageModels)
      .catch((e: unknown) => setImageModels({ ok: false, detail: String(e) }))
      .finally(() => setListing(false))
  }

  const doSave = (): void => {
    setSaving(true)
    setError(null)
    void api()
      .saveSettings(form)
      .then((e) => {
        setLoaded(e)
        setForm(e.settings)
        setSavedAt(new Date().toLocaleTimeString('zh-CN'))
        onSaved(e)
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setSaving(false))
  }

  return (
    <div className="modal" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-box settings-box" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">模型接入设置</h3>

        <label className="ed-row">
          <span className="ed-label">
            网关地址
            {loaded && <SourceTag from={loaded.source.baseUrl} />}
          </span>
          <input
            value={form.baseUrl}
            placeholder="https://你的网关:端口　（留空则走 Anthropic 官方 API）"
            onChange={(e) => set({ baseUrl: e.target.value })}
          />
        </label>

        <label className="ed-row">
          <span className="ed-label">
            API Key
            {loaded && <SourceTag from={loaded.source.apiKey} />}
          </span>
          <span className="key-field">
            <input
              type={showKey ? 'text' : 'password'}
              value={form.apiKey}
              placeholder="sk-..."
              spellCheck={false}
              onChange={(e) => set({ apiKey: e.target.value })}
            />
            <button className="p-act" onClick={() => setShowKey((v) => !v)}>
              {showKey ? '隐藏' : '显示'}
            </button>
          </span>
        </label>

        <label className="ed-row">
          <span className="ed-label">
            模型
            {loaded && <SourceTag from={loaded.source.model} />}
          </span>
          <input
            value={form.model}
            placeholder="claude-opus-5　或网关上的别名"
            spellCheck={false}
            onChange={(e) => set({ model: e.target.value })}
          />
        </label>

        <label className="ed-row">
          <span className="ed-label">
            图模型
            {loaded && <SourceTag from={loaded.source.imageModel} />}
          </span>
          <span className="key-field">
            <input
              value={form.imageModel}
              placeholder="留空用默认值"
              spellCheck={false}
              onChange={(e) => set({ imageModel: e.target.value })}
            />
            <button className="p-act" disabled={listing} onClick={doListImageModels}>
              {listing ? '查询中…' : '看看有哪些'}
            </button>
          </span>
        </label>

        {imageModels && (
          <div className={imageModels.ok ? 'test-result ok' : 'test-result bad'}>
            {imageModels.ok && imageModels.models ? (
              <>
                <strong>{imageModels.detail}</strong>
                <div className="model-chips">
                  {imageModels.models.map((m) => (
                    <button
                      key={m}
                      className={`chip${form.imageModel === m ? ' on' : ''}`}
                      onClick={() => set({ imageModel: m })}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <div className="test-detail">点一个填进上面的框。这些名字和文本模型不通用。</div>
              </>
            ) : (
              <>
                <strong>没查到图模型</strong>
                {imageModels.detail && <div className="test-detail">{imageModels.detail}</div>}
              </>
            )}
          </div>
        )}

        <p className="ed-note">
          图模型只用来画应用题的<strong>生活场景插图</strong>。函数图象、几何图、统计图不走它——
          那些要和题干条件同源、能被机器校验，由本机的绘图工具画（见 architecture.md §4.20）。
          出一张插图约 40 秒。
        </p>

        {warnings.length > 0 && (
          <ul className="ed-errors warn">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}

        {test && (
          <div className={test.ok ? 'test-result ok' : 'test-result bad'}>
            <strong>{test.ok ? '连接正常' : '连接失败'}</strong>
            {test.ms !== undefined && (
              <span className="tabular">　往返 {(test.ms / 1000).toFixed(1)} 秒</span>
            )}
            {test.detail && <div className="test-detail">{test.detail}</div>}
            {test.ok && test.ms !== undefined && test.ms > 3000 && (
              <div className="test-detail">
                这个往返时间偏长，而出一组题要来回十几轮——一轮下来可能要几分钟。
                这部分是网关的固定开销，换模型解决不了。
              </div>
            )}
          </div>
        )}

        {error && <ul className="ed-errors">{<li>{error}</li>}</ul>}

        <p className="ed-note">
          设置存在 <code className="path">{loaded?.filePath ?? '…'}</code>，
          不在课时工作区里——工作区会被拷给同事、放到网盘上，密钥不该跟着课件跑。
        </p>
        <p className="ed-note">
          目标形态是走中继：客户端只拿一个短期凭据，上游厂商密钥永远不落到你的电脑上。
          那个还没做，所以现在这个 Key 是明文存在上面那个文件里的。
        </p>

        <div className="ed-actions">
          <span className="ed-hint">
            {savedAt ? `已保存（${savedAt}）` : '改完记得保存'}
          </span>
          <button className="p-act" disabled={testing} onClick={doTest}>
            {testing ? '测试中…' : '测试连接'}
          </button>
          <button className="p-act" onClick={onClose}>
            关闭
          </button>
          <button className="primary-btn" disabled={saving} onClick={doSave}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
