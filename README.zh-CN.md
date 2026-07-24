# Devin Gateway

[English](README.md) | 简体中文

将 Devin/Windsurf Cascade API 转换为 OpenAI 与 Anthropic 兼容接口，可供 Cherry Studio 和其他兼容客户端使用。

> [!IMPORTANT]
> 使用本项目需要有效的 Devin 或 Windsurf 订阅。本项目不提供账号、订阅或使用额度。

## 功能

- OpenAI Chat Completions：`POST /v1/chat/completions`，支持流式响应
- OpenAI Responses：`POST /v1/responses`，支持流式响应
- Anthropic Messages：`POST /v1/messages`，支持流式响应
- 模型列表：`GET /v1/models`
- OAuth 登录 CLI（`bun run login`）获取 Devin token
- 每次请求自带凭证：客户端通过 `Authorization` 或 `x-api-key` 传入自己的 token
- 运行时无第三方依赖，使用手写 Protobuf 编解码器

## 快速开始

### 1. 登录 Devin

```bash
bun install
bun run login
```

浏览器会自动打开。登录完成后，token 会打印出来并保存到 `~/.devin-gateway/token`。请将打印出的 token 复制到客户端的 API Key 字段中。

其他 CLI 选项：

```bash
bun run login:paste       # 手动粘贴回调 URL
bun run login:status      # 查看当前 token 状态
bun run login -- --print  # 只打印 token，不保存
```

### 2. 启动网关

```bash
bun run start
```

服务默认监听 `http://localhost:3000`。服务端不保存任何 token 状态——每次请求都必须携带凭证：OpenAI 客户端使用 `Authorization: Bearer <token>`，Anthropic 客户端使用 `x-api-key: <token>`。仅当你希望为同时省略这两个头的请求提供兜底时，才设置 `DEVIN_API_KEY`。

### 使用 Docker

发布镜像支持 `linux/amd64` 和 `linux/arm64`。启动前，先在宿主机运行 `bun run login`。

#### `docker run`

```bash
docker run -d \
  --name devin-gateway \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  ghcr.io/caijinglong/devin-gateway:0.4.0

客户端在每次请求中携带自己的 Devin token，因此无需挂载 token 卷。仅当你需要服务端兜底时，才设置 `DEVIN_API_KEY`。

#### Docker Compose

创建 `compose.yaml`：

```yaml
services:
  devin-gateway:
    image: ghcr.io/caijinglong/devin-gateway:0.4.0
    container_name: devin-gateway
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      PORT: "3000"
      HOST: "0.0.0.0"
```

拉取镜像并启动服务：

```bash
docker compose pull
docker compose up -d
docker compose ps
docker compose logs -f
```

停止并删除容器：

```bash
docker compose down
```

仓库内还提供用于本地构建的 `docker-compose.yml`：

```bash
docker compose up -d --build
```

## 获取 Devin Token

### CLI 登录（推荐）

```bash
bun run login
```

登录成功后，token 会写入 `~/.devin-gateway/token` 并打印出来。请将打印出的 token 复制到客户端的 API Key 字段中。

### 环境变量（可选的服务端兜底）

设置 `DEVIN_API_KEY` 可为省略 `Authorization`/`x-api-key` 头的请求提供兜底 token。此项可选——常见做法是每个客户端各自携带自己的 token。

## Cherry Studio 配置

### OpenAI 模式

| 配置项 | 值 |
| --- | --- |
| API 地址 | `http://localhost:3000/v1` |
| API Key | 你的 Devin token |
| 模型 | 通过 `GET /v1/models` 获取，例如 `claude-opus-4-8-low`、`gpt-5-5-none` |

### Anthropic 模式

| 配置项 | 值 |
| --- | --- |
| API 地址 | `http://localhost:3000` |
| API Key | 你的 Devin token |
| 模型 | 与 OpenAI 模式相同 |

## 可用模型

内置模型目录包含 Claude、GPT、Gemini、GLM、Grok、Kimi、DeepSeek 和 SWE 等系列。

```bash
# 从 Devin API 查询当前可用模型，需要有效 token
curl http://localhost:3000/v1/models

# 本网关内置的模型目录快照
curl 'http://localhost:3000/v1/models?source=local'
```

> **注意**：`/v1/models` 默认加载 Devin 实时模型目录；`?source=remote` 是等价的显式写法。下表是内置目录在所标时间的快照。Devin 可用模型随时可能变动，因此本列表**仅供参考，不作为 workflow 的约束**——`model` 接受任意原始 Cascade UID，未知 UID 会直通给 Devin API。实时列表请查询 `GET /v1/models`。

**快照时间：2026-07-23**

| 模型 id | 名称 | 上下文窗口 | 最大输出 |
| --- | --- | --- | --- |
| `claude-5-fable-low` | Claude Fable 5 Low | 1,000,000 | 64,000 |
| `claude-5-fable-medium` | Claude Fable 5 Medium | 1,000,000 | 64,000 |
| `claude-5-fable-high` | Claude Fable 5 High | 1,000,000 | 64,000 |
| `claude-5-fable-xhigh` | Claude Fable 5 XHigh | 1,000,000 | 64,000 |
| `claude-5-fable-max` | Claude Fable 5 Max | 1,000,000 | 64,000 |
| `claude-opus-4-6` | Claude Opus 4.6 | 200,000 | 64,000 |
| `claude-opus-4-6-1m` | Claude Opus 4.6 1M | 1,000,000 | 64,000 |
| `claude-opus-4-7-low` | Claude Opus 4.7 Low | 1,000,000 | 64,000 |
| `claude-opus-4-7-medium` | Claude Opus 4.7 Medium | 1,000,000 | 64,000 |
| `claude-opus-4-7-high` | Claude Opus 4.7 High | 1,000,000 | 64,000 |
| `claude-opus-4-7-xhigh` | Claude Opus 4.7 XHigh | 1,000,000 | 64,000 |
| `claude-opus-4-7-max` | Claude Opus 4.7 Max | 1,000,000 | 64,000 |
| `claude-opus-4-8-low` | Claude Opus 4.8 Low | 1,000,000 | 64,000 |
| `claude-opus-4-8-medium` | Claude Opus 4.8 Medium | 1,000,000 | 64,000 |
| `claude-opus-4-8-high` | Claude Opus 4.8 High | 1,000,000 | 64,000 |
| `claude-opus-4-8-xhigh` | Claude Opus 4.8 XHigh | 1,000,000 | 64,000 |
| `claude-opus-4-8-max` | Claude Opus 4.8 Max | 1,000,000 | 64,000 |
| `claude-opus-4-8-low-fast` | Claude Opus 4.8 Low Fast | 1,000,000 | 64,000 |
| `claude-opus-4-8-medium-fast` | Claude Opus 4.8 Medium Fast | 1,000,000 | 64,000 |
| `claude-opus-4-8-high-fast` | Claude Opus 4.8 High Fast | 1,000,000 | 64,000 |
| `claude-opus-4-8-xhigh-fast` | Claude Opus 4.8 XHigh Fast | 1,000,000 | 64,000 |
| `claude-opus-4-8-max-fast` | Claude Opus 4.8 Max Fast | 1,000,000 | 64,000 |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 | 200,000 | 64,000 |
| `claude-sonnet-4-6-1m` | Claude Sonnet 4.6 1M | 1,000,000 | 64,000 |
| `claude-sonnet-5-low` | Claude Sonnet 5 Low | 1,000,000 | 64,000 |
| `claude-sonnet-5-medium` | Claude Sonnet 5 Medium | 1,000,000 | 64,000 |
| `claude-sonnet-5-high` | Claude Sonnet 5 High | 1,000,000 | 64,000 |
| `claude-sonnet-5-xhigh` | Claude Sonnet 5 XHigh | 1,000,000 | 64,000 |
| `claude-sonnet-5-max` | Claude Sonnet 5 Max | 1,000,000 | 64,000 |
| `deepseek-v4` | DeepSeek V4 Pro | 1,048,576 | 64,000 |
| `gemini-3-1-pro-low` | Gemini 3.1 Pro Low | 1,048,576 | 64,000 |
| `gemini-3-1-pro-high` | Gemini 3.1 Pro High | 1,048,576 | 64,000 |
| `gemini-3-5-flash-minimal` | Gemini 3.5 Flash Minimal | 1,048,576 | 64,000 |
| `gemini-3-5-flash-low` | Gemini 3.5 Flash Low | 1,048,576 | 64,000 |
| `gemini-3-5-flash-medium` | Gemini 3.5 Flash Medium | 1,048,576 | 64,000 |
| `gemini-3-5-flash-high` | Gemini 3.5 Flash High | 1,048,576 | 64,000 |
| `MODEL_GOOGLE_GEMINI_3_0_FLASH_MINIMAL` | Gemini 3 Flash Minimal | 1,048,576 | 64,000 |
| `MODEL_GOOGLE_GEMINI_3_0_FLASH_LOW` | Gemini 3 Flash Low | 1,048,576 | 64,000 |
| `MODEL_GOOGLE_GEMINI_3_0_FLASH_MEDIUM` | Gemini 3 Flash Medium | 1,048,576 | 64,000 |
| `MODEL_GOOGLE_GEMINI_3_0_FLASH_HIGH` | Gemini 3 Flash High | 1,048,576 | 64,000 |
| `glm-5-2` | GLM-5.2 | 200,000 | 64,000 |
| `glm-5-2-none` | GLM-5.2 None | 200,000 | 64,000 |
| `glm-5-2-max` | GLM-5.2 Max | 200,000 | 64,000 |
| `glm-5-2-1m` | GLM-5.2 1M | 1,000,000 | 64,000 |
| `glm-5-2-none-1m` | GLM-5.2 None 1M | 1,000,000 | 64,000 |
| `glm-5-2-max-1m` | GLM-5.2 Max 1M | 1,000,000 | 64,000 |
| `MODEL_GPT_5_2_NONE` | GPT-5.2 None | 384,000 | 64,000 |
| `MODEL_GPT_5_2_LOW` | GPT-5.2 Low | 384,000 | 64,000 |
| `MODEL_GPT_5_2_MEDIUM` | GPT-5.2 Medium | 384,000 | 64,000 |
| `MODEL_GPT_5_2_HIGH` | GPT-5.2 High | 384,000 | 64,000 |
| `MODEL_GPT_5_2_XHIGH` | GPT-5.2 XHigh | 384,000 | 64,000 |
| `gpt-5-3-codex-low` | GPT-5.3 Codex Low | 400,000 | 64,000 |
| `gpt-5-3-codex-medium` | GPT-5.3 Codex Medium | 400,000 | 64,000 |
| `gpt-5-3-codex-high` | GPT-5.3 Codex High | 400,000 | 64,000 |
| `gpt-5-3-codex-xhigh` | GPT-5.3 Codex XHigh | 400,000 | 64,000 |
| `gpt-5-3-codex-low-priority` | GPT-5.3 Codex Fast Low | 400,000 | 64,000 |
| `gpt-5-3-codex-medium-priority` | GPT-5.3 Codex Fast Medium | 400,000 | 64,000 |
| `gpt-5-3-codex-high-priority` | GPT-5.3 Codex Fast High | 400,000 | 64,000 |
| `gpt-5-3-codex-xhigh-priority` | GPT-5.3 Codex Fast XHigh | 400,000 | 64,000 |
| `gpt-5-4-none` | GPT-5.4 None | 272,000 | 64,000 |
| `gpt-5-4-low` | GPT-5.4 Low | 272,000 | 64,000 |
| `gpt-5-4-medium` | GPT-5.4 Medium | 272,000 | 64,000 |
| `gpt-5-4-high` | GPT-5.4 High | 272,000 | 64,000 |
| `gpt-5-4-xhigh` | GPT-5.4 XHigh | 272,000 | 64,000 |
| `gpt-5-4-none-priority` | GPT-5.4 Fast None | 272,000 | 64,000 |
| `gpt-5-4-low-priority` | GPT-5.4 Fast Low | 272,000 | 64,000 |
| `gpt-5-4-medium-priority` | GPT-5.4 Fast Medium | 272,000 | 64,000 |
| `gpt-5-4-high-priority` | GPT-5.4 Fast High | 272,000 | 64,000 |
| `gpt-5-4-xhigh-priority` | GPT-5.4 Fast XHigh | 272,000 | 64,000 |
| `gpt-5-4-mini-low` | GPT-5.4 Mini Low | 400,000 | 64,000 |
| `gpt-5-4-mini-medium` | GPT-5.4 Mini Medium | 400,000 | 64,000 |
| `gpt-5-4-mini-high` | GPT-5.4 Mini High | 400,000 | 64,000 |
| `gpt-5-4-mini-xhigh` | GPT-5.4 Mini XHigh | 400,000 | 64,000 |
| `gpt-5-5-none` | GPT-5.5 None | 272,000 | 64,000 |
| `gpt-5-5-low` | GPT-5.5 Low | 272,000 | 64,000 |
| `gpt-5-5-medium` | GPT-5.5 Medium | 272,000 | 64,000 |
| `gpt-5-5-high` | GPT-5.5 High | 272,000 | 64,000 |
| `gpt-5-5-xhigh` | GPT-5.5 XHigh | 272,000 | 64,000 |
| `gpt-5-5-none-priority` | GPT-5.5 Fast None | 272,000 | 64,000 |
| `gpt-5-5-low-priority` | GPT-5.5 Fast Low | 272,000 | 64,000 |
| `gpt-5-5-medium-priority` | GPT-5.5 Fast Medium | 272,000 | 64,000 |
| `gpt-5-5-high-priority` | GPT-5.5 Fast High | 272,000 | 64,000 |
| `gpt-5-5-xhigh-priority` | GPT-5.5 Fast XHigh | 272,000 | 64,000 |
| `gpt-5-6-luna-none` | GPT-5.6 Luna None | 1,000,000 | 64,000 |
| `gpt-5-6-luna-low` | GPT-5.6 Luna Low | 1,000,000 | 64,000 |
| `gpt-5-6-luna-medium` | GPT-5.6 Luna Medium | 1,000,000 | 64,000 |
| `gpt-5-6-luna-high` | GPT-5.6 Luna High | 1,000,000 | 64,000 |
| `gpt-5-6-luna-xhigh` | GPT-5.6 Luna XHigh | 1,000,000 | 64,000 |
| `gpt-5-6-luna-max` | GPT-5.6 Luna Max | 1,000,000 | 64,000 |
| `gpt-5-6-luna-none-priority` | GPT-5.6 Luna Fast None | 1,000,000 | 64,000 |
| `gpt-5-6-luna-low-priority` | GPT-5.6 Luna Fast Low | 1,000,000 | 64,000 |
| `gpt-5-6-luna-medium-priority` | GPT-5.6 Luna Fast Medium | 1,000,000 | 64,000 |
| `gpt-5-6-luna-high-priority` | GPT-5.6 Luna Fast High | 1,000,000 | 64,000 |
| `gpt-5-6-luna-xhigh-priority` | GPT-5.6 Luna Fast XHigh | 1,000,000 | 64,000 |
| `gpt-5-6-sol-none` | GPT-5.6 Sol None | 1,000,000 | 64,000 |
| `gpt-5-6-sol-low` | GPT-5.6 Sol Low | 1,000,000 | 64,000 |
| `gpt-5-6-sol-medium` | GPT-5.6 Sol Medium | 1,000,000 | 64,000 |
| `gpt-5-6-sol-high` | GPT-5.6 Sol High | 1,000,000 | 64,000 |
| `gpt-5-6-sol-xhigh` | GPT-5.6 Sol XHigh | 1,000,000 | 64,000 |
| `gpt-5-6-sol-max` | GPT-5.6 Sol Max | 1,000,000 | 64,000 |
| `gpt-5-6-sol-none-priority` | GPT-5.6 Sol Fast None | 1,000,000 | 64,000 |
| `gpt-5-6-sol-low-priority` | GPT-5.6 Sol Fast Low | 1,000,000 | 64,000 |
| `gpt-5-6-sol-medium-priority` | GPT-5.6 Sol Fast Medium | 1,000,000 | 64,000 |
| `gpt-5-6-sol-high-priority` | GPT-5.6 Sol Fast High | 1,000,000 | 64,000 |
| `gpt-5-6-sol-xhigh-priority` | GPT-5.6 Sol Fast XHigh | 1,000,000 | 64,000 |
| `gpt-5-6-terra-none` | GPT-5.6 Terra None | 1,000,000 | 64,000 |
| `gpt-5-6-terra-low` | GPT-5.6 Terra Low | 1,000,000 | 64,000 |
| `gpt-5-6-terra-medium` | GPT-5.6 Terra Medium | 1,000,000 | 64,000 |
| `gpt-5-6-terra-high` | GPT-5.6 Terra High | 1,000,000 | 64,000 |
| `gpt-5-6-terra-xhigh` | GPT-5.6 Terra XHigh | 1,000,000 | 64,000 |
| `gpt-5-6-terra-max` | GPT-5.6 Terra Max | 1,000,000 | 64,000 |
| `gpt-5-6-terra-none-priority` | GPT-5.6 Terra Fast None | 1,000,000 | 64,000 |
| `gpt-5-6-terra-low-priority` | GPT-5.6 Terra Fast Low | 1,000,000 | 64,000 |
| `gpt-5-6-terra-medium-priority` | GPT-5.6 Terra Fast Medium | 1,000,000 | 64,000 |
| `gpt-5-6-terra-high-priority` | GPT-5.6 Terra Fast High | 1,000,000 | 64,000 |
| `gpt-5-6-terra-xhigh-priority` | GPT-5.6 Terra Fast XHigh | 1,000,000 | 64,000 |
| `grok-4-5-low` | Grok 4.5 Low | 500,000 | 64,000 |
| `grok-4-5-medium` | Grok 4.5 Medium | 500,000 | 64,000 |
| `grok-4-5-high` | Grok 4.5 High | 500,000 | 64,000 |
| `kimi-k2-6` | Kimi K2.6 | 262,144 | 64,000 |
| `kimi-k2-7` | Kimi K2.7 | 262,144 | 64,000 |
| `nemotron-3-ultra-nvfp4` | Nemotron 3 Ultra | 262,144 | 64,000 |
| `swe-1-6` | SWE-1.6 | 200,000 | 64,000 |
| `swe-1-6-fast` | SWE-1.6 Fast | 200,000 | 64,000 |
| `swe-1-7` | SWE-1.7 Max | 262,000 | 64,000 |
| `swe-1-7-lightning` | SWE-1.7 Lightning | 202,752 | 64,000 |

## 配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DEVIN_API_KEY` | 未设置 | 可选兜底 token，仅在请求未带 `Authorization`/`x-api-key` 时使用 |
| `DEVIN_BASE_URL` | 未设置 | Devin API 地址覆盖项 |

## API 示例

```bash
curl http://localhost:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer devin-session-token$xxxx' \
  -d '{"model":"claude-opus-4-8-low","messages":[{"role":"user","content":"Hello"}]}'
```

流式响应：

```bash
curl http://localhost:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"gpt-5-5-none","messages":[{"role":"user","content":"Hi"}],"stream":true}'
```

### Anthropic Messages

```bash
curl http://localhost:3000/v1/messages \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: devin-session-token$xxxx' \
  -d '{"model":"claude-opus-4-8-low","max_tokens":1024,"messages":[{"role":"user","content":"Hello"}]}'
```

## 以库的形式调用

```ts
import { chat, listModels } from "devin-gateway";

const { text, toolCalls, finishReason } = await chat({
  token: process.env.DEVIN_TOKEN, // 或设置 DEVIN_API_KEY
  model: "claude-opus-4-8-low",
  messages: [{ role: "user", content: "总结这个 PR" }],
});

for (const m of listModels()) console.log(m.id, m.contextWindow);
```

导入本包**不会**启动服务。如需以编程方式启动服务：

```ts
import { startServer } from "devin-gateway";
const handle = await startServer({ port: 3000 });
// ... 用完之后
await handle.stop();
```

`chat()` 仅在读取 token 文件时依赖 Bun 运行时；显式传入 `token` 后即可在纯 Node.js 下运行，适合 GitHub Actions runner。底层能力（`streamChat`、`discoverModels`、`getUserJwt`、格式转换、模型目录）均从包入口重新导出。服务端本身不持有 token 状态——客户端每次请求自带凭证。

## GitHub Actions

仓库内置可复用 workflow `.github/workflows/devin-chat.yml`，把 Devin 当作 model provider 接入任意仓库的 CI——不启动 HTTP 服务、不管端口。token 通过 `secrets` 传入，提示词通过 `with` 传入，回复从 job 输出读取。

完整说明见 **[docs/github-actions.zh-CN.md](docs/github-actions.zh-CN.md)**：输入输出、secret 配置、以及开箱即用的示例（PR 审查、commit message 生成、多步串联）。英文版见 **[docs/github-actions.md](docs/github-actions.md)**。

## 架构

```text
客户端（Cherry Studio 等）
    │  OpenAI / Anthropic 格式
    ▼
Devin Gateway（Bun + 手写 Protobuf）
    │  Connect 协议（Protobuf over HTTP）
    ▼
Devin / Windsurf Cascade API
```

主要文件：

- `src/proto.ts`：所需消息的最小 Protobuf 编解码器
- `src/devin.ts`：Devin API 客户端，包括 GetUserJwt 和流式 GetChatMessage
- `src/models.ts`：模型目录和工作量路由
- `src/convert.ts`：OpenAI、Anthropic 与 Devin 格式转换
- `src/config.ts`：Token 文件读写工具（仅 CLI 登录工具使用，服务端不再读取）
- `src/login.ts`：OAuth PKCE 登录流程
- `src/cli/login.ts`：CLI 登录工具
- `src/server.ts`：HTTP 服务和兼容接口
- `src/client.ts`：高层 `chat()` 客户端，供编程调用或 Actions 使用
- `src/index.ts`：公共入口，重新导出 API，直接运行时启动服务

## 许可证

本项目基于 [MIT License](LICENSE) 发布。
