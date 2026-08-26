# relay —— 中继服务（还没实现）

四份构想笔记都漏了这一层，但它是必需的。见 docs/architecture.md 第 8.3 节。

## 为什么必须有

**API key 不能放在教师机器上。** Electron 应用的本地文件是可以被翻出来的。
这是安全问题，不随性能约束放宽而消失。

顺带它还解决另外三件事：

1. **计量与配额** —— 一位老师约 $8–20/月（见 8.2 的粗算）。这必须在架构里，事后加会很痛。
2. **出网** —— Anthropic API 在大陆不能直连。
3. **换模型的接缝** —— 客户端只认 `ANTHROPIC_BASE_URL`，背后接什么是中继的事。
   国产模型已有 Anthropic 兼容端点（Kimi / GLM / MiniMax 等），见 3.1 节。

## 客户端怎么接

Claude Agent SDK 读这两个环境变量，不需要改代码：

    ANTHROPIC_BASE_URL=https://relay.example.com
    ANTHROPIC_AUTH_TOKEN=<教师短期 token>

中继需要按 Anthropic Messages API 的报文格式提供 `/v1/messages`。

## 边界

**学生数据不出本机。** 发给模型的只有题目、知识点、脱敏后的错误分布，
不发学生姓名。这条要写进产品说明，是学校采购时会被问到的问题。

## 还没定

- 谁来做、部署在哪（影响是否需要单独的后端人手）
- 老师账号体系：个人注册还是学校统一开号
