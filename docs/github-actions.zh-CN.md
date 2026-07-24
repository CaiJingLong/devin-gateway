# GitHub Actions 用法

本仓库提供一个可复用 workflow `.github/workflows/devin-chat.yml`，把 Devin/Windsurf Cascade 当作 model provider，在任意仓库的 CI 里直接调用。调用方无需自己装 Bun、写脚本或起 HTTP 服务——workflow 内部会检出本仓库、安装 Bun、运行 `scripts/chat.ts` 并把模型回复回传为 job output。

## 工作原理

```
调用方 workflow
    │  uses: caijinglong/devin-gateway/.github/workflows/devin-chat.yml@<ref>
    │  secrets: DEVIN_TOKEN
    │  with:   prompt / model / ...
    ▼
devin-chat.yml (reusable workflow)
    │  checkout 本仓库 → setup-bun → bun run scripts/chat.ts
    ▼
scripts/chat.ts → chat() → Devin/Cascade API
    │  回复写入 $GITHUB_OUTPUT (response, finish_reason)
    ▼
调用方通过 needs.<job>.outputs.response 消费
```

不启动 HTTP server，不占端口，单次调用即返回。`chat()` 显式传入 token 时不依赖 Bun 文件 API，适合 Actions runner。

## 前置准备

### 1. 获取 Devin token

workflow 需要的是 token 的**完整字符串值**（形如 `devin-session-token$xxxx...`），用来填入 GitHub secret。以下任一方式均可获取，按你的环境选择。

> 需要有效的 Devin 或 Windsurf 订阅。本网关不提供账号或额度。

#### 方式 A：本地浏览器登录（推荐，有桌面环境）

```bash
git clone https://github.com/caijinglong/devin-gateway.git
cd devin-gateway
bun install
bun run login
```

浏览器自动打开完成 OAuth，token 写入 `~/.devin-gateway/token`。读取字符串值：

```bash
cat ~/.devin-gateway/token
```

或登录时直接打印不落盘：

```bash
bun run login -- --print
```

#### 方式 B：粘贴回调 URL（SSH / 无浏览器 / 远程机器）

本机无法接收浏览器回调时（SSH、容器、无头服务器），用 paste 模式手动粘贴：

```bash
bun run login:paste
```

按提示打开打印出的 auth URL，在浏览器完成登录后，把地址栏里的回调 URL（形如 `http://127.0.0.1:59653/callback?code=...&state=...`）粘贴回终端。同样可加 `--print` 只打印 token：

```bash
bun run login:paste -- --print
```

#### 方式 C：Web 登录（已在本机跑着 gateway）

启动服务后浏览器打开 `http://localhost:3000/login`，完成授权后 token 写入同一文件。若回调无法到达本机（远程部署），页面上有粘贴框，把回调 URL 粘进去即可。

#### 方式 D：检查现有 token

```bash
bun run login:status     # 显示 token 状态（前缀 + 是否存在）
cat ~/.devin-gateway/token   # 直接读出完整值
```

#### 关于 DEVIN_API_KEY 环境变量

`DEVIN_API_KEY` 是给 gateway 服务端用的优先级覆盖项，**不是获取 token 的方式**。workflow 调用的是 `chat()`，它读 `DEVIN_TOKEN`（脚本入参）或 `DEVIN_API_KEY` 环境变量——但在 Actions 里应通过 `secrets.DEVIN_TOKEN` 传入，不要用环境变量明文。

### 2. 在调用方仓库配置 secret

进入调用方仓库 → Settings → Secrets and variables → Actions → New repository secret：

- Name: `DEVIN_TOKEN`
- Value: 上一步拿到的完整 token（含 `devin-session-token$` 前缀）

组织级 secret 同样可用。建议定期轮换 token。

### 3. 固定 workflow ref

`uses:` 里的 `@<ref>` 建议固定到具体 tag（如 `@v0.1.0`）或 commit SHA，避免上游变更意外影响你的 CI。`@main` 可用于前期调试，不建议长期使用。

## 输入参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `prompt` | string | 是 | — | 用户提示词 |
| `system` | string | 否 | `""` | 系统提示词 |
| `model` | string | 否 | `glm-5-2` | Cascade 模型 UID，见[可用模型](../README.zh-CN.md#可用模型) |
| `max-tokens` | number | 否 | `0` | 最大输出 token，`0` 表示用服务端默认 |
| `temperature` | number | 否 | `0` | 采样温度，`0` 表示用服务端默认 |
| `top-p` | number | 否 | `0` | top-p，`0` 表示用服务端默认 |
| `base-url` | string | 否 | `""` | 覆盖 Devin API base URL，留空用默认 |

### secret

| secret | 必填 | 说明 |
| --- | --- | --- |
| `DEVIN_TOKEN` | 是 | Devin session token（`devin-session-token$...`） |

## 输出

| output | 说明 |
| --- | --- |
| `response` | 模型回复文本（可能多行，已用 delimiter 安全编码） |
| `finish_reason` | OpenAI 风格的结束原因（`stop` / `tool_calls` / ...） |

## 最小示例

```yaml
name: Ask Devin

on:
  pull_request:
    types: [opened]

jobs:
  ask-devin:
    uses: caijinglong/devin-gateway/.github/workflows/devin-chat.yml@v0.1.0
    secrets:
      DEVIN_TOKEN: ${{ secrets.DEVIN_TOKEN }}
    with:
      prompt: "用一句话总结这个 PR 的改动"

  echo:
    needs: ask-devin
    runs-on: ubuntu-latest
    steps:
      - run: echo "${{ needs.ask-devin.outputs.response }}"
```

## 实战示例

### PR 代码审查

在 PR 打开时让模型审查 diff，并把结果评论到 PR 上。需要 `pull-requests: write` 权限。

```yaml
name: Devin PR review

on:
  pull_request:
    types: [opened]

permissions:
  pull-requests: write
  contents: read

jobs:
  review:
    uses: caijinglong/devin-gateway/.github/workflows/devin-chat.yml@v0.1.0
    secrets:
      DEVIN_TOKEN: ${{ secrets.DEVIN_TOKEN }}
    with:
      system: "你是资深代码审查者，用中文输出。"
      prompt: |
        审查以下 PR diff，指出潜在 bug、风险和改进点，分条列出。
        仓库：${{ github.event.pull_request.head.repo.full_name }}
        PR #${{ github.event.pull_request.number }}：${{ github.event.pull_request.title }}
        ${{
          github.event.pull_request.body
        }}

  comment:
    needs: review
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `### Devin 审查\n\n${{ needs.review.outputs.response }}`,
            });
```

### 生成 commit message

根据 diff 生成 Conventional Commits 格式的 commit message。

```yaml
name: Devin commit message

on:
  workflow_dispatch:

jobs:
  generate:
    uses: caijinglong/devin-gateway/.github/workflows/devin-chat.yml@v0.1.0
    secrets:
      DEVIN_TOKEN: ${{ secrets.DEVIN_TOKEN }}
    with:
      system: "输出 Conventional Commits 格式，仅一行标题 + 可选正文，不要多余解释。"
      prompt: "为以下改动生成 commit message：\n\n${{ vars.RECENT_DIFF }}"
      model: "glm-5-2-max"
```

### 手动触发 + 自定义模型

```yaml
name: Devin on demand

on:
  workflow_dispatch:
    inputs:
      question:
        description: "问题"
        required: true

jobs:
  ask:
    uses: caijinglong/devin-gateway/.github/workflows/devin-chat.yml@v0.1.0
    secrets:
      DEVIN_TOKEN: ${{ secrets.DEVIN_TOKEN }}
    with:
      prompt: ${{ inputs.question }}
      model: "claude-opus-4-8-max"
      max-tokens: 8192
```

### 串联多步：先总结再翻译

```yaml
jobs:
  summarize:
    uses: caijinglong/devin-gateway/.github/workflows/devin-chat.yml@v0.1.0
    secrets:
      DEVIN_TOKEN: ${{ secrets.DEVIN_TOKEN }}
    with:
      prompt: "用三个要点总结这份文档：${{ vars.DOC }}"

  translate:
    needs: summarize
    uses: caijinglong/devin-gateway/.github/workflows/devin-chat.yml@v0.1.0
    secrets:
      DEVIN_TOKEN: ${{ secrets.DEVIN_TOKEN }}
    with:
      prompt: "把以下内容翻译成英文：\n\n${{ needs.summarize.outputs.response }}"
```

## 注意事项

- **token 安全**：`DEVIN_TOKEN` 必须放在 `secrets`，不要硬编码或写入 `with`。workflow 日志里 `scripts/chat.ts` 只打印回复，不打印 token。
- **ref 固定**：生产用固定 tag 或 SHA；`@main` 会随上游变动。
- **并发**：reusable workflow 每次调用是独立 job，无端口/状态冲突，可并发触发。
- **超时**：默认 job 超时 360 分钟（GitHub 上限）。Devin 长回复可能耗时较久，必要时在调用方 job 用 `timeout-minutes` 控制。
- **模型可用性**：`model` 参数不校验是否在目录内——传未知 UID 会直通给 Devin API。目录内的模型 id 见主 README 的「可用模型」章节，但该列表随时可能更新，**不作为 workflow 的约束**；以 `GET /v1/models?source=remote` 的实时结果为准。
- **Bun 版本**：workflow 用 `oven-sh/setup-bun@v2` 的 `latest`，如需固定版本可在本仓库 fork 后修改。

## 故障排查

| 现象 | 排查 |
| --- | --- |
| `DEVIN_TOKEN is required` | 调用方仓库未配置 `DEVIN_TOKEN` secret，或 `secrets:` 映射写错 |
| `Devin API 401/403` | token 失效或订阅过期，重新 `bun run login` 并更新 secret |
| `response` 为空 | 模型返回空内容；检查 `finish_reason`，或调高 `max-tokens` |
| job 超时 | 长回复或服务端慢；调用方加 `timeout-minutes`，或减小 `max-tokens` |
| `uses` 解析失败 | ref 不存在或仓库未公开；确认 tag/SHA 正确 |
