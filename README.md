# Devin Gateway

将 Devin/Windsurf Cascade API 转为标准 OpenAI 和 Anthropic 接口，可在 Cherry Studio 等客户端中使用。

## 功能

- **OpenAI Chat Completions** — `POST /v1/chat/completions`（支持流式）
- **OpenAI Responses** — `POST /v1/responses`（支持流式）
- **Anthropic Messages** — `POST /v1/messages`（支持流式）
- **模型列表** — `GET /v1/models`
- **OAuth 登录** — `GET /login` 浏览器授权，或 CLI `bun run login` 直接获取
- 零外部依赖，手写 protobuf 编解码，内存占用低

## 快速开始

### 1. 登录获取 Token

```bash
bun install
bun run login          # 自动打开浏览器登录 Devin，token 保存到 ~/.devin-gateway/token
```

其他 CLI 选项：
```bash
bun run login:paste    # 手动粘贴回调 URL（无浏览器自动跳转时使用）
bun run login:status   # 查看当前 token 状态
bun run login -- --print  # 只打印 token 不保存
```

### 2. 启动服务

```bash
bun run start          # 自动读取 ~/.devin-gateway/token
```

### Docker

```bash
# 先在本地登录获取 token，然后挂载配置目录到容器
docker compose up -d

# 或通过环境变量直接传入
DEVIN_API_KEY=devin-session-token$xxxx docker compose up -d
```

## 获取 Devin Token

**方式一：CLI 登录（推荐）**
```bash
bun run login
```
自动打开浏览器，登录 Devin 后 token 保存到 `~/.devin-gateway/token`，服务启动时自动读取。

**方式二：Web 登录**
启动服务后访问 `http://localhost:3000/login`，浏览器授权后 token 自动保存。

**方式三：环境变量**
设置 `DEVIN_API_KEY` 环境变量（优先级高于配置文件）。

## 在 Cherry Studio 中使用

### OpenAI 模式

| 配置项 | 值 |
|--------|-----|
| API 地址 | `http://localhost:3000/v1` |
| API Key | 你的 Devin token（或任意值，如果服务已配置 token） |
| 模型 | 从 `GET /v1/models` 获取，如 `claude-opus-4-8`、`gpt-5-5` 等 |

### Anthropic 模式

| 配置项 | 值 |
|--------|-----|
| API 地址 | `http://localhost:3000` |
| API Key | 你的 Devin token |
| 模型 | 同上 |

## 可用模型

包含 Claude、GPT、Gemini、GLM、Grok、Kimi、DeepSeek、SWE 等系列，完整列表见 `GET /v1/models`。

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DEVIN_API_KEY` | — | Devin session token（优先于配置文件） |
| `DEVIN_GATEWAY_CONFIG_DIR` | `~/.devin-gateway` | token 配置目录 |
| `DEVIN_BASE_URL` | — | Devin API 地址覆盖 |

## API 示例

```bash
# 非流式
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer devin-session-token$xxxx" \
  -d '{"model":"claude-opus-4-8","messages":[{"role":"user","content":"Hello"}]}'

# 流式
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5-5","messages":[{"role":"user","content":"Hi"}],"stream":true}'

# Anthropic
curl http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-opus-4-8","max_tokens":1024,"messages":[{"role":"user","content":"Hello"}]}'
```

## 架构

```
客户端 (Cherry Studio / etc.)
    │  OpenAI / Anthropic 格式
    ▼
Devin Gateway (Bun + 手写 protobuf)
    │  Connect 协议 (protobuf over HTTP)
    ▼
- `src/proto.ts` — 最小 protobuf 编解码（仅实现所需消息）
- `src/devin.ts` — Devin API 客户端（GetUserJwt + GetChatMessage 流式）
- `src/models.ts` — 模型目录
- `src/convert.ts` — OpenAI/Anthropic ↔ Devin 格式转换
- `src/config.ts` — 共享配置（token 读写）
- `src/login.ts` — OAuth PKCE 登录流程
- `src/cli/login.ts` — CLI 登录工具
- `src/server.ts` — HTTP 路由
