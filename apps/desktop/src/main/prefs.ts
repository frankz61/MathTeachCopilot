/**
 * 界面偏好的读写（目前只有教材版本）。
 *
 * 和 settings.ts 同样不 import electron，userData 路径由 index.ts 传进来。
 *
 * 存 `userData/prefs.json`，不和模型接入挤在 settings.json 里：
 * writeSettings 每次整份重写那个文件，混在一起的话，保存一次模型设置
 * 就会把教材版本冲掉——老师下次打开发现又变回默认版本，而且查不出为什么。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_TEXTBOOK, TEXTBOOKS, type Preferences, type Textbook } from '@mtc/shared'

export function prefsFile(userDataDir: string): string {
  return path.join(userDataDir, 'prefs.json')
}

const isTextbook = (v: unknown): v is Textbook =>
  typeof v === 'string' && (TEXTBOOKS as readonly string[]).includes(v)

/** 文件不存在、坏了、填了不认识的版本，都回默认值——偏好读不到不该挡住启动 */
export function readPreferences(userDataDir: string): Preferences {
  const file = prefsFile(userDataDir)
  if (!existsSync(file)) return { textbook: DEFAULT_TEXTBOOK }
  try {
    const o = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>
    return { textbook: isTextbook(o.textbook) ? o.textbook : DEFAULT_TEXTBOOK }
  } catch {
    return { textbook: DEFAULT_TEXTBOOK }
  }
}

export function writePreferences(userDataDir: string, p: Preferences): Preferences {
  const body: Preferences = { textbook: isTextbook(p.textbook) ? p.textbook : DEFAULT_TEXTBOOK }
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(prefsFile(userDataDir), JSON.stringify(body, null, 2), 'utf-8')
  return body
}
