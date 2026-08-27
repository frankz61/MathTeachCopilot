/**
 * 不用 API key 就能做的自检：确认客户端启动 Python 工具进程这条路是通的。
 *
 * `pnpm spike` 需要 API key，而这个脚本不需要——它只验证 mcp.ts 生成的命令
 * 能真的拉起子进程、完成 MCP 握手、列出工具。链路断了的典型表现是
 * Agent init 时报 failed 而所有单元测试全绿，所以值得单独有这一步。
 *
 *   pnpm check
 *
 * 也可以指定一个 baseDir，用来**验打包产物**——这条最值钱：
 * 开发期一切正常而打包后工具进程起不来是真实发生过的（embeddable Python 的
 * ._pth 会关掉「脚本目录自动进 sys.path」），而那个故障只会出现在老师的机器上。
 *
 *   pnpm check apps/desktop/dist/win-unpacked/resources
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mathtoolsServer } from '../src/main/mcp.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
/**
 * 不传就验仓库；传了就验那个目录（打包产物的 resources/）。
 *
 * 相对路径按**命令敲下去的那个目录**解析（pnpm 放在 INIT_CWD 里），不能按 cwd：
 * `pnpm check <dir>` 是在仓库根敲的，而 pnpm 会把脚本的 cwd 切到 apps/desktop，
 * 直接 resolve 会拼出 apps/desktop/apps/desktop/...。那个目录不存在，
 * mcp.ts 就静默退回 uv 开发链路——于是「验打包产物」验的其实是源码，还报一切正常。
 */
const invokedFrom = process.env['INIT_CWD'] ?? process.cwd()
const baseDir = process.argv[2] ? path.resolve(invokedFrom, process.argv[2]) : repoRoot
const EXPECTED = [
  'verify_algebra',
  'verify_answer_shape',
  'render_figure',
  'render_illustration',
  'export_docx',
]

interface RpcResponse {
  id?: number
  result?: { tools?: { name: string }[] }
  error?: { message?: string }
}

async function main(): Promise<void> {
  const cfg = mathtoolsServer(baseDir)
  if (baseDir !== repoRoot) {
    console.log(`验的是：${baseDir}`)
    // 指定了 baseDir 却退回 uv，说明那儿没有随包 Python。继续跑只会验到开发链路，
    // 绿得毫无意义——发版流程正是靠这一步拦住「打出来的包起不来工具进程」。
    if (cfg.command === 'uv') {
      fail(
        `${baseDir} 下没有 vendor/python/python.exe + tools-py/server.py，\n` +
          '  这不是打包产物的 resources/ 目录（或者 pnpm vendor:python 没跑过）',
      )
    }
  }
  console.log(`启动命令：${cfg.command} ${cfg.args.join(' ')}\n`)

  // 不用 shell:true —— 参数不转义有注入风险，而且 Agent SDK 拉起 MCP server
  // 时也不会用 shell，这里必须和它一致，否则测过了真跑仍然会挂。
  const child = spawn(cfg.command, cfg.args, {
    env: { ...process.env, ...cfg.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let stderr = ''
  child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))

  const responses = new Map<number, RpcResponse>()
  let buffer = ''
  child.stdout.on('data', (d: Buffer) => {
    buffer += d.toString()
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      try {
        const msg = JSON.parse(line) as RpcResponse
        if (typeof msg.id === 'number') responses.set(msg.id, msg)
      } catch {
        /* 服务器的非协议输出，忽略 */
      }
    }
  })

  const send = (obj: unknown): void => {
    child.stdin.write(JSON.stringify(obj) + '\n')
  }
  const waitFor = async (id: number, label: string): Promise<RpcResponse> => {
    for (let i = 0; i < 300; i++) {
      const r = responses.get(id)
      if (r) return r
      await new Promise((res) => setTimeout(res, 100))
    }
    fail(`${label} 超时（30 秒）。stderr:\n${stderr}`)
  }

  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'mtc-check', version: '0' },
    },
  })
  const init = await waitFor(1, 'initialize')
  if (init.error) fail(`握手失败：${init.error.message}\n${stderr}`)
  console.log('[1/2] ✓ MCP 握手成功')

  send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  const list = await waitFor(2, 'tools/list')
  const names = (list.result?.tools ?? []).map((t) => t.name)
  const missing = EXPECTED.filter((n) => !names.includes(n))
  if (missing.length > 0) fail(`缺工具：${missing.join(', ')}（实际有：${names.join(', ')}）`)
  console.log(`[2/2] ✓ 工具齐全：${names.join(', ')}`)

  child.kill()
  console.log('\n工具链没问题。下一步跑 pnpm spike（需要 ANTHROPIC_API_KEY）。')
}

function fail(msg: string): never {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
