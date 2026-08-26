# MathTeachCopilot

面向初中数学教师的 harness 客户端。不是能写教案的聊天框，是**带教材上下文、带数学正确性保障、带可复用流程**的教师工作台。

产品结论见 [docs/decision.md](docs/decision.md)，架构见 [docs/architecture.md](docs/architecture.md)。
四份原始构想笔记在 [docs/](docs/)。

## 第一版做什么

Windows 桌面客户端，三栏骨架，**只上一个 Skill：分层出题 / 变式生成**。
范围锁死在人教版九年级上册「一元二次方程」一章（2024 修订版第 25 章；旧版编号第 21 章）。

选出题而不是写教案，是因为它是唯一能被机器验证的产物——CAS 过一遍就知道对不对。
理由展开见 [docs/decision.md](docs/decision.md) 第三节。

**红线**：数学正确性。每道代数题必须过两条独立的验算路径才算绿，红色的题禁止导出。
老师遇到一次错答案就不会再打开这个软件。

## 跑起来

前置：Node 20+、pnpm、[uv](https://docs.astral.sh/uv/)。

```bash
pnpm install
pnpm py:sync
```

验算器的测试（不需要 API key，也不需要联网）：

```bash
pnpm py:test
```

开发模式启动客户端：

```bash
pnpm dev
```

只调界面时不必等 Electron 起来，直接在浏览器里跑（`window.mtc` 不存在时会退回
`devFixture.ts` 的演示数据，含绿/黄/红三种状态）：

```bash
pnpm dev:ui
```

教师工作区默认在用户目录下的 `MathTeachCopilot/`。第一次可以把示例课时拷进去：

```bash
cp -r examples/* ~/MathTeachCopilot/
```

## 模型接入怎么配

启动后点右上角**设置**，填网关地址、API Key、模型。没配的话启动时会自动弹出来。

- **地址末尾不要带 `/v1`** —— SDK 自己会拼 `/v1/messages`，带了会请求成
  `/v1/v1/messages`。宽松的网关会容忍，严格的直接 404，两种都不该赌。
  设置界面会就这一条给出警告。
- 地址留空则走 Anthropic 官方 API。
- 填完点**测试连接**，它会真发一次最小请求，并把往返耗时报出来。
  这个数字有用：中转网关常有好几秒的每请求固定开销，而出一组题要来回十几轮
  （见 [architecture.md §4.15](docs/architecture.md)）。

设置存在 Electron 的 `userData/settings.json`，**不在课时工作区里**——工作区会被拷给
同事、放到网盘上，密钥不该跟着课件走。

开发期也可以用仓库根的 `.env`（见 `.env.example`）。优先级是
**设置界面 > .env > 进程环境**，设置界面里每一项旁边会标出它实际来自哪儿。

## 打包安装包

```bash
pnpm icon
pnpm vendor:python
pnpm dist
```

`pnpm icon` 生成 `apps/desktop/build/icon.ico`（多尺寸）和 `icon.png`，
另外出一张 `icon-preview.png` 拼版——**图标好不好看只能用眼睛判断**，
尤其是 16px 那一张，所以拼版是浅底深底各一排。

`vendor:python` 下载官方 embeddable Python 并把 sympy / matplotlib / mcp 装进去，
最后**用随包解释器实跑一次** `server.py` 确认能起来。
另外需要手动把 `pandoc.exe` 放到 `vendor/pandoc/`（见 [vendor/README.md](vendor/README.md)）。

产物在 `apps/desktop/dist/`。安装包不小（Electron + Python + pandoc + Agent SDK 的
`claude.exe` 加起来接近 1 GB）——体积不是这个项目的约束，见 architecture.md 的前提。

装完是一个普通目录（**没开 asar**），出问题能直接进去看。

## 教材数据

`curriculum/` 里的教材树由脚本从 MathMate 的知识图谱导入：

```bash
pnpm import:curriculum
```

现有 **北师大版全六册**（34 章 / 141 知识点 / 51 条常见错因 / 116 个带前置关系）
和**人教版全六册**（2024 修订版新教材，34 章 / 114 知识点 / 149 条常见错因 / 103 个带前置关系，
目录据电子课本网等公开来源整理）。

人教版自 2024 年秋起换用修订版，章号全六册连续（1–34），与旧版不同——
一元二次方程由旧版第 21 章变为第 25 章。九下要 2027 春才启用，
其目录是修订版公布稿，教材出版后需复核（见该文件 `source` 字段）。

注意 `standard`（课标条目原文）字段目前只有人教版第 25 章有值（MVP 手工整理稿），
其余是空的——没有可靠来源就不拿内容摘要冒充课标。
详见 [docs/architecture.md](docs/architecture.md) 第六甲节。

## 自检与 spike

不需要 API key 的工具链自检（验证客户端能拉起 Python 工具进程）：

```bash
pnpm check
```

课时目录监听的回归检查（「加了题界面不刷新」那个 bug）：

```bash
pnpm check:watch
```

从教材树建课时的行为检查（重点是「已存在绝不覆盖」）：

```bash
pnpm check:lesson
```

设置的读写与优先级（不需要联网）：

```bash
pnpm check:settings
```

题型分布——验「会不会混着出选择/填空/解答/证明」，需要 API key：

```bash
pnpm check:types auto/claude-sonnet
```

一轮生成的耗时账单，拆出网关固定开销 × 轮数：

```bash
pnpm check:speed auto/claude-sonnet
```

端到端 spike（需要 `.env` 里的模型配置，见 [.env.example](.env.example)）：

```bash
pnpm spike
```

它验证：Agent SDK 跑得通、MCP 连得上工具进程、Agent 走闸门写题、导出为 OMML 而非图片。
**2026-08-19 已全部跑通**，结果见 [docs/architecture.md](docs/architecture.md) 第十节。

## 调试

`.vscode/` 里的配置开箱可用（先确保仓库根有 `.env`，从 `.env.example` 拷一份）。
按 F5 选配置：

| 配置 | 用途 |
|---|---|
| **全栈调试（主进程 + 渲染进程）** | 日常调 UI 就用这个，两边断点都生效 |
| 主进程 | 只调 `src/main/`：Agent 编排、IPC、文件读写 |
| 渲染进程 | 只调 React（需先起主进程） |
| spike（端到端） | 调 Agent 全流程。断点打在 `agent.ts` 的 `onEvent` 分支能看清每一步 |
| 工具链自检 | 不需要 API key，只验证能否拉起 Python 工具进程 |
| Python：当前测试文件 / 全部测试 | 调验算器、闸门、导出 |
| Python：重建示例课时 | 每道种子题都会真跑验算，适合在 `verify.py` 里下断点 |
| Python：附加到工具进程 | 调「被 Agent 驱动时」的工具代码，见下 |

### 调试工具进程

工具进程是 Electron 拉起来的子进程，没法从 VS Code 直接启动，只能让它监听、由调试器附加：

1. 在 `.env` 里加 `MTC_DEBUGPY=1`
2. 启动「主进程」或跑 spike
3. 再选「Python：附加到工具进程」，断点打在 `tools-py/mathtools/` 下

想在工具进程启动的第一行就断住，把 `MTC_DEBUGPY` 改成 `wait`，同时设 `MCP_TIMEOUT=600000`
——否则 MCP 握手会在 30 秒后先超时。

命令面板里还有一组任务（`Ctrl+Shift+P` → Tasks: Run Task），
其中「全量校验」把类型检查、Python 测试、工具链自检串起来跑一遍，提交前用。

## 结构

```
apps/desktop/      Electron 客户端
  src/main/          主进程：窗口、文件、Agent 编排、MCP client
  src/renderer/      React 三栏 UI
  scripts/spike.ts   端到端 spike，不依赖 Electron
packages/
  shared/          共享类型：题目对象、课时、IPC 契约
  workspace/       课时文件夹读写
  skills/          Skill 定义（系统提示 + 工具契约）
tools-py/          Python MCP server：SymPy 验算 / 作图 / 导出
curriculum/        教材树配置数据（只读，随包分发）
examples/          示例课时，拷到工作区用
vendor/            随包分发的二进制：pandoc、embeddable python
relay/             中继服务（未实现，但架构上必需）
eval/              评测集（未建，需要真实教师投入）
```

## 几条不要绕过的约定

- **上传的图片存进课时的 `assets/`**，Agent 用内置 Read 工具看——不塞进提示词。
  这样图片属于工作区：能当题目配图复用、能随卷子导出、老师能自己打开。
- **老师改题走同一道闸门**：保存时按 `check` 规格重新验算，验不过就不保存、原题保留。
  改了答案而验证戳还挂着绿色，等于产品在替错题背书。
- **problems.json 是唯一事实来源**，homework.md 是它的派生视图，自动重新生成。
  老师要的固定抬头写在 `preamble.md`，那是模板不是内容，重生成不会丢。
- **产物是文件，不是聊天记录。** 一个课时 = 一个文件夹，老师能直接打开、拷给同事、进教研组共享盘。没有数据库。
- **problems.json 只能经 `save_problems` 写**，不能用 Write。它会自己重跑验算、自己写
  verify 字段——否则模型可以凭空编一个 green。理由见 [docs/architecture.md](docs/architecture.md) §4.1。
  散文类产物（homework.md）仍走 Agent 的 Write/Edit，那里 diff 才有价值。
- **验算是纯代码，不许有模型参与。** 见 `tools-py/mathtools/verify.py`，双路径校验。
- **界面刷新只认文件监听**（`src/main/watcher.ts`），不要挂在 agent 的 `file` 事件上——
  那是发起工具调用的时刻，文件还没落盘，读到的是旧内容。
- **异步 IPC 调用必须 catch。** `void api().runAgent(...)` 不接 catch 的话，主进程
  在发出任何事件前抛错时 promise 静默 reject，`busy` 永远卡在 true——之后所有按钮
  都是禁用的，表现就是「按钮没用」，且毫无线索。
- **改了 IPC 契约要完全退出应用重启**，不能只靠 HMR。HMR 只更新渲染层，preload 不会重载，
  于是渲染层调一个 preload 里还不存在的方法 → useEffect 抛错 → React 卸载整棵树 →
  **界面看得见但点不动**。现在有 ErrorBoundary 和缺方法降级兜底，会明确告诉你，
  但根治办法还是重启。
- **导出闸门在 Python 工具层**（`export.py` 的 `gate()`），不靠模型自觉，也不靠 UI 拦。
- **老师点的按钮不要绕 Agent。** 导出这类确定性动作走 `tools-py/cli.py`（主进程直调），
  MCP server 只服务 Agent。让模型代劳既慢又可能中途改主意。
- **API key 不能放在教师机器上。** 第一版直连是权宜，上线前必须走中继，见 [relay/README.md](relay/README.md)。

## 状态

**骨架已跑通，端到端验证完成**（2026-08-19）：

- Python 工具层 55 个测试通过，含 MCP stdio 子进程链路和 OMML 回归测试
- 类型检查全过，Electron 构建与 `pnpm dev` 启动正常
- `pnpm spike` 端到端通过：Agent 出题 → 强制验算 → 落盘 → 导出可编辑公式的 Word

下一步：把出题 Skill 的完整逻辑铺开（分层配比、变式迭代、驳回单段重出），
以及 [relay/README.md](relay/README.md) 里那个还没实现的中继服务。
