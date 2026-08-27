#!/usr/bin/env node
/**
 * 升版本号：同时改根 package.json 和 apps/desktop/package.json，两边永远一致。
 *
 *   pnpm bump 1.2.3        指定完整版本号
 *   pnpm bump --patch      0.1.0 -> 0.1.1（也支持 --minor / --major）
 *
 * 为什么不用 `pnpm version`：它一次只改一个 package.json，而 electron-builder
 * 取的是 apps/desktop 的版本、发布流程（.github/workflows/release.yml）校验的
 * 是 tag 和它一致——两边不同步时最省事的路就是忘掉根目录那份。
 *
 * 跑完打印发版三步：提交、打 tag、推。tag 一推，release.yml 会自动
 * 准备 vendor、打包 NSIS 安装包并发布到 GitHub Releases（见 workflow 注释）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const FILES = ['package.json', path.join('apps', 'desktop', 'package.json')]

function readVersion(file) {
  return JSON.parse(readFileSync(path.join(repoRoot, file), 'utf-8')).version
}

function writeVersion(file, version) {
  const full = path.join(repoRoot, file)
  const pkg = JSON.parse(readFileSync(full, 'utf-8'))
  pkg.version = version
  // 两个空格 + 行尾换行，和仓库里现有文件保持一致，diff 只有两行版本号
  writeFileSync(full, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
}

function inc(version, part) {
  const parts = version.split('.')
  const idx = part === 'major' ? 0 : part === 'minor' ? 1 : 2
  const n = Number(parts[idx])
  if (!Number.isInteger(n)) {
    throw new Error(`版本号 ${version} 不是标准的 x.y.z，手工指定完整版本号再改`)
  }
  parts[idx] = String(n + 1)
  for (let i = idx + 1; i < 3; i++) parts[i] = '0'
  return parts.join('.')
}

const arg = process.argv[2]
if (!arg) {
  console.error('用法：pnpm bump <x.y.z | --patch | --minor | --major>')
  process.exit(1)
}

const current = readVersion(FILES[0])
const next =
  arg.startsWith('--') ? inc(current, arg.slice(2)) : arg

// 允许 0.1.0-beta.1 这类预发布后缀，但主干必须三段数字——
// electron-builder 和 release.yml 的 tag 校验都按这个形状来
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(next)) {
  console.error(`「${next}」不是合法版本号（形如 1.2.3 或 1.2.3-beta.1）`)
  process.exit(1)
}

// 先把两份全校验完，再动手写。
//
// 边校验边写是不行的：第二份对不上时第一份已经改掉了，于是「两份不一致」
// 这件事反而被推得更远——本来只差一个版本号，跑完差两个，还是它自己弄出来的。
for (const f of FILES) {
  // 不一致就直接停：静默改成同一个会掩盖「哪份是对的」这个问题
  const v = readVersion(f)
  if (v !== current) {
    console.error(`${f} 的版本（${v}）和根目录（${current}）不一致，先手工对齐再 bump`)
    process.exit(1)
  }
}

for (const f of FILES) writeVersion(f, next)

console.log(`版本号：${current} -> ${next}（根 package.json 与 apps/desktop/package.json）`)
console.log('')
console.log('发版三步：')
console.log(`  git commit -am "release: v${next}"`)
console.log(`  git tag v${next}`)
console.log(`  git push && git push --tags   # tag 一推，release.yml 自动打包并发布到 GitHub Releases`)
