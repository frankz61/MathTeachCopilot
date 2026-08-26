/**
 * 主进程直接调 Python 工具（不经过 Agent）。
 *
 * 老师点「导出」这类动作不该绕一圈让模型代劳：慢、贵，而且模型可能中途改主意
 * 或者干脆不调。这类确定性动作走命令行入口 tools-py/cli.py。
 *
 * MCP server 仍然只服务 Agent，两条路各管各的。
 */
import { spawn } from 'node:child_process'
import { mathtoolsServer } from './mcp.js'

export interface PyToolResult {
  ok: boolean
  error?: string
  [key: string]: unknown
}

/**
 * 复用 mcp.ts 的解释器解析（打包用 vendor 的 python，开发用 uv run），
 * 只把入口从 server.py 换成 cli.py —— 免得两处各写一份路径推导，改了一处忘另一处。
 */
export function runPyTool(
  command: string,
  payload: unknown,
  baseDir: string,
  timeoutMs = 120_000,
): Promise<PyToolResult> {
  const cfg = mathtoolsServer(baseDir)
  const args = cfg.args.map((a) => (a.endsWith('server.py') ? a.replace(/server\.py$/, 'cli.py') : a))

  return new Promise((resolve) => {
    const child = spawn(cfg.command, [...args, command], {
      env: { ...process.env, ...cfg.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve({ ok: false, error: `${command} 超时（${timeoutMs / 1000} 秒）` })
    }, timeoutMs)

    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, error: `启动 Python 失败：${e.message}` })
    })
    child.on('close', () => {
      clearTimeout(timer)
      // uv 会往 stdout 打自己的进度信息，真正的结果是最后一行 JSON
      const line = stdout.trim().split(/\r?\n/).pop() ?? ''
      try {
        resolve(JSON.parse(line) as PyToolResult)
      } catch {
        resolve({
          ok: false,
          error: `Python 没有返回合法 JSON：${(stderr || stdout).trim().slice(0, 400)}`,
        })
      }
    })

    child.stdin.write(JSON.stringify(payload))
    child.stdin.end()
  })
}
