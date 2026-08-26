"""验证 server.py 作为**子进程**跑得起来并且真的会说 MCP 协议。

其余测试都是进程内直接调函数，测不到「Electron 主进程把 Python 拉起来」这一段。
这个链路断了的表现是：Agent 看得见工具名却调不动，或者干脆 init 时报 failed，
而单元测试全绿——所以必须单独测。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

SERVER = Path(__file__).resolve().parents[1] / "server.py"

# 和 apps/desktop/src/main/mcp.ts 里给子进程设的环境变量保持一致
ENV = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}

EXPECTED_TOOLS = {
    "verify_algebra",
    "verify_answer_shape",
    "render_figure",
    "export_docx",
}


@pytest.mark.anyio
async def test_子进程能握手并列出全部工具() -> None:
    params = StdioServerParameters(
        command=sys.executable, args=[str(SERVER)], env=ENV
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            names = {t.name for t in tools.tools}
            assert EXPECTED_TOOLS <= names, f"缺工具：{EXPECTED_TOOLS - names}"

            # 工具描述是模型唯一的使用说明，空描述等于没接线
            for t in tools.tools:
                assert t.description and len(t.description) > 40, f"{t.name} 描述太短"


@pytest.mark.anyio
async def test_子进程里验算真的会拦下错答案() -> None:
    params = StdioServerParameters(
        command=sys.executable, args=[str(SERVER)], env=ENV
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            good = await session.call_tool(
                "verify_algebra",
                {
                    "kind": "solve",
                    "equation": "x^2 - 5*x + 6 = 0",
                    "variable": "x",
                    "claimed_roots": ["2", "3"],
                },
            )
            assert '"status": "green"' in _text(good)

            bad = await session.call_tool(
                "verify_algebra",
                {
                    "kind": "solve",
                    "equation": "x^2 - 5*x + 6 = 0",
                    "variable": "x",
                    "claimed_roots": ["2", "4"],
                },
            )
            assert '"status": "red"' in _text(bad)


def _text(result: object) -> str:
    content = getattr(result, "content", [])
    return "".join(getattr(c, "text", "") for c in content)


@pytest.fixture(scope="module")
def anyio_backend() -> str:
    return "asyncio"
