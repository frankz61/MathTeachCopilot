# MathTeachCopilot

面向初中数学教师的 harness 客户端。不是能写教案的聊天框，是**带教材上下文、带数学正确性保障、带可复用流程**的教师工作台。

产品结论见 [docs/decision.md](docs/decision.md)，架构与实跑教训见 [docs/architecture.md](docs/architecture.md)。
四份原始构想笔记：[chatgpt.md](docs/chatgpt.md)、[claude.md](docs/claude.md)、[grok.md](docs/grok.md)、[zcode.md](docs/zcode.md)。

## 第一版做什么

Windows 桌面客户端，三栏骨架，**只上一个 Skill：分层出题 / 变式生成**。
范围锁死在人教版九年级上册「一元二次方程」一章（2024 修订版第 25 章；旧版编号第 21 章）。

选出题而不是写教案，是因为它是唯一能被机器验证的产物——CAS 过一遍就知道对不对。
理由展开见 [docs/decision.md](docs/decision.md) 第三节。

**红线**：数学正确性。每道代数题必须过两条独立的验算路径才算绿，红色的题禁止导出。
老师遇到一次错答案就不会再打开这个软件。

## 工作原理

一句话：**Electron 主进程里跑 Claude Agent SDK，Agent 通过 MCP 调一个常驻的
Python 工具进程，产物是课时文件夹里的纯文件。** 没有数据库。

```
渲染进程（React 三栏：左=教材树与课时，中=题目卡片与作业，右=Agent）
   │  IPC（契约在 packages/shared/src/ipc.ts，preload 只暴露这一份）
主进程（Node）
   ├─ Workspace     课时文件夹读写、目录监听（watcher.ts）
   ├─ Agent SDK     query() 循环，cwd = 课时目录
   │     │ MCP stdio
   │  Python 工具进程（tools-py/server.py，常驻）
   │     ├─ SymPy 验算（双路径）+ 答案形态检查
   │     ├─ matplotlib 作图（函数 / 几何 / 统计）+ 生图模型情境插图
   │     └─ pandoc 导出 docx（OMML 可编辑公式）
   └─ cli.py        老师点的确定性按钮（导出等）由主进程直调，不绕 Agent
```

一轮生成的闭环：主进程把**会话包**（课时元信息、知识点详情含常见错因、已有题目数、
assets/ 里已有的图）拼进提示词 → Agent 出题 → 每道题经 `save_problems` **闸门**落盘
（工具自己按 check 规格重跑验算，红的直接拒收）→ 主进程监听到 problems.json 变化 →
重新生成 homework.md → 推 UI 刷新。**刷新只认文件监听，不信 Agent 的自述**——
done 时还会核对题目数，没变化就报失败。

### Python 工具层的 7 个 MCP 工具

| 工具 | 职责 |
|---|---|
| `lookup_curriculum` | 查教材知识点：内容摘要 / 中考权重 / 常见错因 / 前置 |
| `verify_algebra` | CAS 验算：解方程 / 恒等变形 / 求值，每种走两条独立路径 |
| `verify_answer_shape` | 答案「好不好看」：整数解、判别式完全平方、比例可约 |
| `save_problems` | 写 problems.json 的**唯一入口**：校验结构 + 强制重跑验算 |
| `render_figure` | 函数图象 / 数轴 / 几何 / 统计图 → SVG；几何图按 asserts 实算校验 |
| `render_illustration` | 生活场景插图 → PNG（生图模型，不可校验，带关键词拦截） |
| `export_docx` | Markdown + LaTeX → docx（OMML 公式），自带导出闸门 |

### 三态验证

每道题带验证戳（`verify` 字段），颜色直接显示在题目卡片上：

- **green** —— 两条独立验算路径都过，可导出给学生
- **yellow** —— 机器验不了的题型（证明 / 几何 / 概念判断 / 作图），仅教师预览
- **red** —— 验算失败，**禁止导出**（闸门在工具层强制，不靠模型自觉，也不靠 UI 拦）

验算是纯代码（SymPy），**不许有模型参与**：模型只提交题目和「该怎么验」
（`check` 规格），验算结果由工具写进 `verify`——模型碰不到那个字段。

## 课时文件夹

教师工作区默认在 `~/MathTeachCopilot/`，一个课时 = 一个文件夹：

```
~/MathTeachCopilot/
└── 人教九上/25-一元二次方程/02-2-公式法/
    ├── meta.json           # 教材 / 年级 / 章 / 课时 / 知识点 id / 状态
    ├── problems.json       # 题目对象（含 check 规格与验证戳）——唯一事实来源
    ├── homework.md         # 分层作业，problems.json 的派生视图，自动重生成
    ├── preamble.md         # 老师要的固定抬头（姓名 / 班级），模板不会被覆盖
    ├── conversation.json   # 会话历史（只增不删，留最近 200 轮，带产出增量）
    └── assets/             # 题目插图 SVG / PNG、上传的照片与截图
```

- **problems.json 只能经 `save_problems` 写**，老师和 Agent 走同一道闸门：
  老师改题保存时同样重新验算，验不过就不保存、原题保留。
- **homework.md 不是第二份内容**。老师删掉一道题而手上那张卷子还是旧的、
  且看不出来——那是所有 bug 里后果最实的一种（错的卷子会真印出来发下去）。
- 整个文件夹能直接打开、拷给同事、进教研组共享盘，不需要理解任何「系统」。

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

示例课时里每道题的验证戳都是**真跑验算得来的**（`pnpm seed` 重新生成）——
它既是给新人看的样例，也是验算器的一次真实演练，验算器坏了重跑它会立刻暴露。

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
pnpm vendor:pandoc
pnpm dist
```

`pnpm icon` 生成 `apps/desktop/build/icon.ico`（多尺寸）和 `icon.png`，
另外出一张 `icon-preview.png` 拼版——**图标好不好看只能用眼睛判断**，
尤其是 16px 那一张，所以拼版是浅底深底各一排。

`vendor:python` 下载官方 embeddable Python 并把 sympy / matplotlib / mcp 装进去，
最后**用随包解释器实跑一次** `server.py` 确认能起来。
`vendor:pandoc` 取钉死版本的 `pandoc.exe`，并**真转一份带公式的 docx**
确认公式是 OMML 而不是图片（见 [vendor/README.md](vendor/README.md)）。

产物在 `apps/desktop/dist/`。安装包不小（Electron + Python + pandoc + Agent SDK 的
`claude.exe` 加起来接近 1 GB）——体积不是这个项目的约束，见 architecture.md 的前提。

装完是一个普通目录（**没开 asar**），出问题能直接进去看。

打完有两步验证最值钱，都是真实翻过车的地方。一是**拿打包产物验工具链**
（开发期正常而打包后 Python 工具进程起不来）：

```bash
pnpm check apps/desktop/dist/win-unpacked/resources
```

二是**把应用真启动一次**：

```bash
pnpm check:app apps/desktop/dist/win-unpacked/MathTeachCopilot.exe
```

v0.1.0 就是栽在第二条上——主进程用具名导入引了 CommonJS 的 electron-updater，
而编译产物是 ESM，装到机器上启动即崩，而类型检查、构建、打包、工具链自检**全绿**。
Windows 上打包出来是 GUI 子系统程序，崩了只弹个框、stderr 一个字都没有，
所以判定靠 `MTC_SMOKE=1`：应用初始化完自己退出，没在超时内以 0 退出就是没起来。
不带参数跑（`pnpm check:app`）验的是 `pnpm build` 出的 out/，几秒钟，CI 每次都跑。

## 发版

版本号改一次要落到两份 `package.json`（根的 + `apps/desktop` 的，electron-builder
取后者），所以别手改：

```bash
pnpm bump --patch          # 或 --minor / --major / 直接给 1.2.3
git commit -am "release: v0.0.2"
git tag v0.0.2
git push && git push --tags
```

tag 一推，[`.github/workflows/release.yml`](.github/workflows/release.yml) 接手：
干净 checkout → 类型检查 → 生成图标 → 备好随包 Python 和 pandoc →
跑 Python 测试（**这一趟 pandoc 在，OMML 回归测试才真的执行**，CI 里它是 skip 的）→
先打成目录形态**验一次工具链**→ 过了才打 NSIS 安装包并发布到 GitHub Releases。

验证在发布之前是刻意的：老师端会自动更新（见下），坏版本一旦发出去就已经被拉走了。

发布上去的是三件套——安装包、`.blockmap`、`latest.yml`。
`apps/desktop/src/main/updater.ts` 靠 `latest.yml` 对版本、靠 blockmap 只下变过的块
（近 1 GB 的包，差量是「等得动」和「等不动」的差别）。

**不需要配任何 secret。** 发布用的是 Actions 每次 run 临时铸的 `GITHUB_TOKEN`
（workflow 里映射成 electron-builder 认的 `GH_TOKEN`），run 一结束就失效，
比长期有效的 PAT 安全得多。要 PAT 的只有两种情况：发到别的仓库，或者从本机发版
——后者不建议，发版产物应当来自干净 checkout。

还有一条前提值得记住：**自动更新能用，是因为这个仓库是 public**，
electron-updater 匿名去拉 Releases 附件。转私有这条链就断，而 publish 段的
`private: true` 的含义是把 token 打进老师的安装包里——那不是私有分发的解法，
中继才是（见 [relay/README.md](relay/README.md)）。

想在打 tag 之前先验一遍整条链路，去 Actions 里手工触发 Release（只打包不发布，
勾上 upload 还能把安装包留成 artifact）。

CI（[`ci.yml`](.github/workflows/ci.yml)）只在 push main 和 PR 上跑，**不认 tag**，
所以 release.yml 自己重跑一遍类型检查，不指望「main 上绿过」。

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

复现某个课时的「没反应 / 空转」，走和 UI 完全一样的链路并逐步打耗时：

```bash
pnpm repro -- "<课时id>" "<提示词>" [模型别名]
```

端到端 spike（需要 `.env` 里的模型配置，见 [.env.example](.env.example)）：

```bash
pnpm spike
```

它验证：Agent SDK 跑得通、MCP 连得上工具进程、Agent 走闸门写题、导出为 OMML 而非图片。
**2026-08-19 已全部跑通**，结果见 [docs/architecture.md](docs/architecture.md) 第十节。

### 命令一览

| 命令 | 干什么 | 要 API key |
|---|---|---|
| `pnpm dev` / `pnpm dev:ui` | 启动客户端 / 只在浏览器跑渲染层（演示数据） | 否 |
| `pnpm build` / `pnpm typecheck` | 全仓构建 / 类型检查 | 否 |
| `pnpm py:sync` / `pnpm py:test` | 装工具进程依赖 / 跑 Python 测试 | 否 |
| `pnpm seed` | 重新生成 examples/ 示例课时（真跑验算） | 否 |
| `pnpm check` | 工具链自检（能否拉起 Python 工具进程） | 否 |
| `pnpm check:app` | 启动自检（应用起不起得来，不传参验 out/，传 exe 验打包产物） | 否 |
| `pnpm check:watch` / `check:lesson` / `check:settings` | 目录监听 / 建课时 / 设置优先级回归 | 否 |
| `pnpm check:types` / `check:speed` | 题型分布 / 一轮生成耗时账单 | 是 |
| `pnpm repro` | 复现某课时的一轮生成，逐步打耗时 | 是 |
| `pnpm spike` | 端到端：Agent → MCP → 闸门落盘 → 导出 | 是 |
| `pnpm import:curriculum` | 从 MathMate 知识图谱导入教材树 | 否 |
| `pnpm icon` / `vendor:python` / `vendor:pandoc` | 图标 / 随包 Python / 随包 pandoc | 否 |
| `pnpm dist` / `dist:dir` | 打安装包 / 只打目录形态（用来验工具链） | 否 |
| `pnpm bump <x.y.z\|--patch>` | 升版本号（两份 package.json 一起改），见[发版](#发版) | 否 |

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
apps/desktop/        Electron 客户端
  src/main/            主进程：窗口、Agent 编排（agent.ts）、MCP client（mcp.ts）、
                       目录监听（watcher.ts）、设置（settings.ts）、直调 Python 工具（pytool.ts）
  src/preload/         IPC 桥，只暴露 shared/ipc.ts 列出的契约
  src/renderer/        React 三栏 UI + 题目编辑器 / 变式对话框 / 设置窗
  scripts/             spike 与各 check:* 脚本，复用主进程链路、不依赖 Electron
packages/
  shared/            共享类型：题目对象、课时、IPC 契约、设置、教材树
  workspace/         课时文件夹读写（Workspace 类）+ 教材树加载
  skills/            Skill 定义：系统提示 + 工具白/黑名单（第一版只有 problems）
tools-py/            Python 工具层：server.py 是 MCP 入口，cli.py 供主进程直调
  mathtools/           verify / store / figure / geometry / charts / illustration /
                       export / homework / curriculum 九个模块
  tests/               188 个测试：验算、闸门、作图、选择题三路径、OMML 回归、MCP stdio 链路
  import_curriculum.py 教材树导入；seed_example.py 示例课时；prepare_vendor.py 随包 Python
curriculum/          教材树配置数据（北师大版 / 人教版各六册，只读，随包分发）
examples/            示例课时（人教九上·公式法），拷到工作区用
vendor/              随包分发的二进制：pandoc、embeddable python（构建时准备，不进版本库）
relay/               中继服务（未实现，但架构上必需）
eval/                评测集（未建，需要真实教师投入）
docs/                decision / architecture / 四份构想笔记
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

**骨架已跑通，端到端验证完成**：

- Python 工具层 **188 个测试通过**（2026-08-27 复核），含 MCP stdio 子进程链路、
  选择题三路径校验和 OMML 回归测试
- 类型检查全过，Electron 构建与 `pnpm dev` 启动正常
- `pnpm spike` 端到端通过（2026-08-19）：Agent 出题 → 强制验算 → 落盘 →
  导出可编辑公式的 Word
- 真实工作区里验证过：题型配比（选择/填空/解答/证明/作图）、几何统计题默认配图、
  变式对话框、会话历史落盘、老师改题走闸门重新验算

下一步：把出题 Skill 的完整逻辑铺开（分层配比、变式迭代、驳回单段重出），
以及 [relay/README.md](relay/README.md) 里那个还没实现的中继服务。
