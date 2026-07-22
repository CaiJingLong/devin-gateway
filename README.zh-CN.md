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
- OAuth 登录：通过 `GET /login` 或 `bun run login` 获取 Devin token
- Token 热更新：宿主机登录后，Docker 容器无需重启
- 运行时无第三方依赖，使用手写 Protobuf 编解码器

## 快速开始

### 1. 登录 Devin

```bash
bun install
bun run login
```

浏览器会自动打开。登录完成后，token 保存在 `~/.devin-gateway/token`。

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

服务默认监听 `http://localhost:3000`，并自动读取 `~/.devin-gateway/token`。

### 使用 Docker

发布镜像支持 `linux/amd64` 和 `linux/arm64`。启动前，先在宿主机运行 `bun run login`。

#### `docker run`

```bash
docker run -d \
  --name devin-gateway \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e DEVIN_GATEWAY_CONFIG_DIR=/config \
  -v "$HOME/.devin-gateway:/config" \
  ghcr.io/caijinglong/devin-gateway:0.1.0
```

该卷将宿主机的 token 目录映射到容器内的 `/config`。后续重新运行 `bun run login` 时，容器会自动加载新 token，无需重启。

#### Docker Compose

创建 `compose.yaml`：

```yaml
services:
  devin-gateway:
    image: ghcr.io/caijinglong/devin-gateway:0.1.0
    container_name: devin-gateway
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      PORT: "3000"
      HOST: "0.0.0.0"
      DEVIN_GATEWAY_CONFIG_DIR: /config
    volumes:
      - "${HOME}/.devin-gateway:/config"
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

登录成功后，token 写入 `~/.devin-gateway/token`。

### Web 登录

启动服务后访问 `http://localhost:3000/login`。授权完成后，token 会写入同一个配置文件。

### 环境变量

设置 `DEVIN_API_KEY`。该变量的优先级高于配置文件。

## Cherry Studio 配置

### OpenAI 模式

| 配置项 | 值 |
| --- | --- |
| API 地址 | `http://localhost:3000/v1` |
| API Key | 你的 Devin token |
| 模型 | 通过 `GET /v1/models` 获取，例如 `claude-opus-4-8`、`gpt-5-5` |

### Anthropic 模式

| 配置项 | 值 |
| --- | --- |
| API 地址 | `http://localhost:3000` |
| API Key | 你的 Devin token |
| 模型 | 与 OpenAI 模式相同 |

## 可用模型

内置模型目录包含 Claude、GPT、Gemini、GLM、Grok、Kimi、DeepSeek 和 SWE 等系列。

```bash
# 本地模型目录
curl http://localhost:3000/v1/models

# 从 Devin API 查询当前可用模型，需要有效 token
curl 'http://localhost:3000/v1/models?source=remote'
```

## 配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DEVIN_API_KEY` | 未设置 | Devin session token，优先于配置文件 |
| `DEVIN_GATEWAY_CONFIG_DIR` | `~/.devin-gateway` | Token 配置目录 |
| `DEVIN_BASE_URL` | 未设置 | Devin API 地址覆盖项 |

## API 示例

### OpenAI Chat Completions

```bash
curl http://localhost:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer devin-session-token$xxxx' \
  -d '{"model":"claude-opus-4-8","messages":[{"role":"user","content":"Hello"}]}'
```

流式响应：

```bash
curl http://localhost:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"gpt-5-5","messages":[{"role":"user","content":"Hi"}],"stream":true}'
```

### Anthropic Messages

```bash
curl http://localhost:3000/v1/messages \
  -H 'Content-Type: application/json' \
  -d '{"model":"claude-opus-4-8","max_tokens":1024,"messages":[{"role":"user","content":"Hello"}]}'
```

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
- `src/config.ts`：Token 文件读写和热更新
- `src/login.ts`：OAuth PKCE 登录流程
- `src/cli/login.ts`：CLI 登录工具
- `src/server.ts`：HTTP 服务和兼容接口

## 许可证

本项目基于 [MIT License](LICENSE) 发布。
