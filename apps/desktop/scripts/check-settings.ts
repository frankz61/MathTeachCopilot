/**
 * 模型接入设置的读写与优先级。
 *
 * 浏览器 fixture 验的是界面，这里验主进程那一半——尤其是**优先级**。
 * 优先级本身反直觉（设置 > .env > 环境变量），而且一旦搞错，症状是
 * 「我改了怎么没生效」，从报错里完全看不出来。见 config.ts 开头那段。
 *
 * 跑法：
 *   pnpm check:settings
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  resolveEffective,
  settingsFile,
  writeSettings,
  DEFAULT_MODEL,
  DEFAULT_IMAGE_MODEL,
} from '../src/main/settings.js'
import { settingsWarnings, type LlmSettings } from '@mtc/shared'

let passed = 0
const failures: string[] = []

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failures.push(`${name}${detail ? `  —— ${detail}` : ''}`)
    console.log(`  ✗ ${name}${detail ? `  —— ${detail}` : ''}`)
  }
}

const dirs: string[] = []
function tmp(prefix: string): string {
  const d = mkdtempSync(path.join(tmpdir(), prefix))
  dirs.push(d)
  return d
}

function main(): void {
  // 进程环境里可能本来就带着这些（在 Claude Code 里跑本项目时就是如此），
  // 会污染下面的优先级判断，先清掉
  delete process.env['ANTHROPIC_BASE_URL']
  delete process.env['ANTHROPIC_API_KEY']
  delete process.env['MTC_MODEL']
  delete process.env['MTC_IMAGE_MODEL']

  console.log('[1/5] 空目录：什么都没设置')
  {
    const userData = tmp('mtc-set-')
    const repo = tmp('mtc-repo-')
    const e = resolveEffective(userData, repo)
    check('configured 为 false', e.configured === false)
    check('apiKey 来源是 none', e.source.apiKey === 'none', e.source.apiKey)
    check('model 落到默认值', e.settings.model === DEFAULT_MODEL, e.settings.model)
    check('model 来源标成 default', e.source.model === 'default', e.source.model)
    // 图模型必须有个**显示得出来**的默认值：界面上留空框的话，
    // 老师没法判断插图到底是用什么画的
    check(
      'imageModel 落到默认值',
      e.settings.imageModel === DEFAULT_IMAGE_MODEL,
      e.settings.imageModel,
    )
    check('imageModel 来源标成 default', e.source.imageModel === 'default', e.source.imageModel)
    check('filePath 指向 userData', e.filePath === settingsFile(userData))
  }

  console.log('[2/5] 只有 .env（开发期形态）')
  {
    const userData = tmp('mtc-set-')
    const repo = tmp('mtc-repo-')
    writeFileSync(
      path.join(repo, '.env'),
      'ANTHROPIC_BASE_URL=https://from-dotenv\nANTHROPIC_API_KEY=sk-dotenv\nMTC_MODEL=m-dotenv\n' +
        'MTC_IMAGE_MODEL=img-dotenv\n',
      'utf-8',
    )
    const e = resolveEffective(userData, repo)
    check('configured 为 true', e.configured === true)
    check('值来自 .env', e.settings.apiKey === 'sk-dotenv', e.settings.apiKey)
    check('来源标成 dotenv', e.source.baseUrl === 'dotenv', e.source.baseUrl)
    check('图模型也认 .env', e.settings.imageModel === 'img-dotenv', e.settings.imageModel)
  }

  console.log('[3/5] 设置文件优先于 .env')
  {
    const userData = tmp('mtc-set-')
    const repo = tmp('mtc-repo-')
    writeFileSync(
      path.join(repo, '.env'),
      'ANTHROPIC_BASE_URL=https://from-dotenv\nANTHROPIC_API_KEY=sk-dotenv\nMTC_MODEL=m-dotenv\n' +
        'MTC_IMAGE_MODEL=img-dotenv\n',
      'utf-8',
    )
    writeSettings(userData, {
      baseUrl: 'https://from-settings',
      apiKey: 'sk-settings',
      model: 'm-settings',
      imageModel: 'img-settings',
    })
    const e = resolveEffective(userData, repo)
    check('三项都来自设置文件', e.settings.apiKey === 'sk-settings', e.settings.apiKey)
    check('来源标成 settings', e.source.model === 'settings', e.source.model)
    check('图模型也来自设置文件', e.settings.imageModel === 'img-settings', e.settings.imageModel)

    // 只填了一项时，其余各项**各自**回落，而不是整份配置一起回落。
    // 整份回落会造出最难查的一种状态：地址是新的、密钥还是旧的。
    writeSettings(userData, { baseUrl: 'https://only-url', apiKey: '', model: '', imageModel: '' })
    const e2 = resolveEffective(userData, repo)
    check('没填的项各自回落到 .env', e2.settings.apiKey === 'sk-dotenv', e2.settings.apiKey)
    check('填了的项仍用设置文件', e2.settings.baseUrl === 'https://only-url', e2.settings.baseUrl)
    check('来源逐项不同', e2.source.baseUrl === 'settings' && e2.source.apiKey === 'dotenv')
    check('图模型回落到 .env', e2.settings.imageModel === 'img-dotenv', e2.settings.imageModel)
  }

  console.log('[4/5] 写入时的规范化与容错')
  {
    const userData = tmp('mtc-set-')
    const repo = tmp('mtc-repo-')
    writeSettings(userData, {
      baseUrl: '  https://gw.example.com//  ',
      apiKey: '  sk-x  ',
      model: '  m  ',
      imageModel: '  img  ',
    })
    const e = resolveEffective(userData, repo)
    check('去掉首尾空白', e.settings.apiKey === 'sk-x', JSON.stringify(e.settings.apiKey))
    check(
      '去掉末尾斜杠',
      e.settings.baseUrl === 'https://gw.example.com',
      e.settings.baseUrl,
    )

    // 文件坏了不能崩——老师手改坏了 JSON，软件不该打不开
    writeFileSync(settingsFile(userData), '{ 这不是 json', 'utf-8')
    let crashed = false
    let e2: ReturnType<typeof resolveEffective> | null = null
    try {
      e2 = resolveEffective(userData, repo)
    } catch {
      crashed = true
    }
    check('设置文件坏掉不抛异常', !crashed)
    check('坏掉时如实报未设置', e2?.configured === false, String(e2?.source.apiKey))
  }

  console.log('[5/5] 填写警告')
  {
    const bad: LlmSettings = {
      baseUrl: 'https://gw.example.com/v1',
      apiKey: 'k',
      model: 'm',
      imageModel: '',
    }
    const w = settingsWarnings(bad)
    // 带 /v1 会让 SDK 请求 /v1/v1/messages。宽松的网关容忍、严格的 404，都不该赌
    check('带 /v1 的地址会被警告', w.some((x) => x.includes('/v1')), w.join(' | '))
    const good: LlmSettings = {
      baseUrl: 'https://gw.example.com',
      apiKey: 'k',
      model: 'm',
      imageModel: '',
    }
    check('正常填写没有警告', settingsWarnings(good).length === 0, settingsWarnings(good).join(' | '))
    const empty: LlmSettings = { baseUrl: '', apiKey: 'k', model: 'm', imageModel: '' }
    check('地址留空不算问题（走官方 API）', settingsWarnings(empty).length === 0)
    // 图模型留空是常态（有默认值），不该报警告
    check('图模型留空不算问题', settingsWarnings({ ...good, imageModel: '' }).length === 0)
    // 但填成文本模型那个名字是确定错的：图接口上没有那个别名，
    // 症状是四十秒后一个 400，值得当场提醒
    const sameName: LlmSettings = { ...good, imageModel: 'm' }
    check(
      '图模型和文本模型同名会被警告',
      settingsWarnings(sameName).some((x) => x.includes('图模型')),
      settingsWarnings(sameName).join(' | '),
    )
  }

  for (const d of dirs) rmSync(d, { recursive: true, force: true })

  console.log()
  if (failures.length > 0) {
    console.error(`✗ ${failures.length} 项没过：`)
    for (const f of failures) console.error(`  - ${f}`)
    process.exit(1)
  }
  console.log(`设置读写与优先级正常（${passed}/${passed}）。`)
}

main()
