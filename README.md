# Devin Gateway

English | [简体中文](README.zh-CN.md)

Expose the Devin/Windsurf Cascade API through OpenAI- and Anthropic-compatible endpoints for Cherry Studio and other compatible clients.

> [!IMPORTANT]
> An active Devin or Windsurf subscription is required. This gateway does not provide an account, subscription, or usage quota.

## Features

- OpenAI Chat Completions: `POST /v1/chat/completions`, with streaming support
- OpenAI Responses: `POST /v1/responses`, with streaming support
- Anthropic Messages: `POST /v1/messages`, with streaming support
- Model listing: `GET /v1/models`
- OAuth login through `GET /login` or `bun run login`
- Live token reload: logging in on the host does not require a container restart
- No third-party runtime dependencies; Protobuf encoding and decoding are implemented in the project

## Quick start

### 1. Sign in to Devin

```bash
bun install
bun run login
```

A browser window opens automatically. After sign-in, the token is stored at `~/.devin-gateway/token`.

Other CLI options:

```bash
bun run login:paste       # Paste the callback URL manually
bun run login:status      # Show the current token status
bun run login -- --print  # Print the token without saving it
```

### 2. Start the gateway

```bash
bun run start
```

The gateway listens on `http://localhost:3000` by default and reads `~/.devin-gateway/token` automatically.

### Docker

The published image supports `linux/amd64` and `linux/arm64`. Sign in on the host with `bun run login` before starting it.

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

The volume maps the host token directory to `/config`. A later `bun run login` updates the running container without a restart.

#### Docker Compose

Create `compose.yaml`:

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

Start and inspect the service:

```bash
docker compose pull
docker compose up -d
docker compose ps
docker compose logs -f
```

Stop and remove the container:

```bash
docker compose down
```

The repository also includes a development `docker-compose.yml` that builds the image locally:

```bash
docker compose up -d --build
```

## Getting a Devin token

### CLI login (recommended)

```bash
bun run login
```

A successful login writes the token to `~/.devin-gateway/token`.

### Web login

Start the gateway and open `http://localhost:3000/login`. The completed authorization flow writes to the same token file.

### Environment variable

Set `DEVIN_API_KEY`. It takes precedence over the token file.

## Cherry Studio configuration

### OpenAI mode

| Setting | Value |
| --- | --- |
| API base URL | `http://localhost:3000/v1` |
| API key | Your Devin token |
| Model | Read from `GET /v1/models`, for example `claude-opus-4-8` or `gpt-5-5` |

### Anthropic mode

| Setting | Value |
| --- | --- |
| API base URL | `http://localhost:3000` |
| API key | Your Devin token |
| Model | Same list as OpenAI mode |

## Models

The built-in catalog covers Claude, GPT, Gemini, GLM, Grok, Kimi, DeepSeek, SWE, and related model families.

```bash
# Built-in model catalog
curl http://localhost:3000/v1/models

# Current models reported by the Devin API; requires a valid token
curl 'http://localhost:3000/v1/models?source=remote'
```

> **Note**: The table below is a snapshot of the built-in catalog at the time shown. Devin's available models change at any time, so this list is **for reference only and is not a constraint on the workflow** — `model` accepts any raw Cascade UID and passes unknown UIDs straight through. For the live list, query `GET /v1/models?source=remote`.

**Snapshot time: 2026-07-23**

| Model id | Name | Context window | Max tokens | Effort levels |
| --- | --- | --- | --- | --- |
| `claude-5-fable-low` | Claude Fable 5 Low | 1,000,000 | 64,000 | — |
| `claude-5-fable-medium` | Claude Fable 5 Medium | 1,000,000 | 64,000 | — |
| `claude-5-fable-high` | Claude Fable 5 High | 1,000,000 | 64,000 | — |
| `claude-5-fable-xhigh` | Claude Fable 5 XHigh | 1,000,000 | 64,000 | — |
| `claude-5-fable-max` | Claude Fable 5 Max | 1,000,000 | 64,000 | — |
| `claude-opus-4-6` | Claude Opus 4.6 | 200,000 | 64,000 | — |
| `claude-opus-4-6-1m` | Claude Opus 4.6 1M | 1,000,000 | 64,000 | — |
| `claude-opus-4-7` | Claude Opus 4.7 | 1,000,000 | 64,000 | low/medium/high/xhigh/max |
| `claude-opus-4-7-fast` | Claude Opus 4.7 Fast | 1,000,000 | 64,000 | low/medium/high/xhigh/max |
| `claude-opus-4-8` | Claude Opus 4.8 | 1,000,000 | 64,000 | low/medium/high/xhigh/max |
| `claude-opus-4-8-fast` | Claude Opus 4.8 Fast | 1,000,000 | 64,000 | low/medium/high/xhigh/max |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 | 200,000 | 64,000 | — |
| `claude-sonnet-4-6-1m` | Claude Sonnet 4.6 1M | 1,000,000 | 64,000 | — |
| `claude-sonnet-5-low` | Claude Sonnet 5 Low | 1,000,000 | 64,000 | — |
| `claude-sonnet-5-medium` | Claude Sonnet 5 Medium | 1,000,000 | 64,000 | — |
| `claude-sonnet-5-high` | Claude Sonnet 5 High | 1,000,000 | 64,000 | — |
| `claude-sonnet-5-xhigh` | Claude Sonnet 5 XHigh | 1,000,000 | 64,000 | — |
| `claude-sonnet-5-max` | Claude Sonnet 5 Max | 1,000,000 | 64,000 | — |
| `deepseek-v4` | DeepSeek V4 Pro | 1,048,576 | 64,000 | — |
| `gemini-3-1-pro` | Gemini 3.1 Pro | 1,048,576 | 64,000 | — |
| `gemini-3-5-flash` | Gemini 3.5 Flash | 1,048,576 | 64,000 | — |
| `gemini-3-flash` | Gemini 3 Flash | 1,048,576 | 64,000 | — |
| `glm-5-2` | GLM-5.2 | 200,000 | 64,000 | low/medium/high/xhigh/max |
| `glm-5-2-1m` | GLM-5.2 1M | 1,000,000 | 64,000 | — |
| `gpt-5-2` | GPT-5.2 | 384,000 | 64,000 | — |
| `gpt-5-3-codex` | GPT-5.3 Codex | 400,000 | 64,000 | — |
| `gpt-5-3-codex-fast` | GPT-5.3 Codex Fast | 400,000 | 64,000 | — |
| `gpt-5-4` | GPT-5.4 | 272,000 | 64,000 | — |
| `gpt-5-4-fast` | GPT-5.4 Fast | 272,000 | 64,000 | — |
| `gpt-5-4-mini` | GPT-5.4 Mini | 400,000 | 64,000 | — |
| `gpt-5-5` | GPT-5.5 | 272,000 | 64,000 | — |
| `gpt-5-5-fast` | GPT-5.5 Fast | 272,000 | 64,000 | — |
| `gpt-5-6-luna` | GPT-5.6 Luna | 1,000,000 | 64,000 | — |
| `gpt-5-6-luna-fast` | GPT-5.6 Luna Fast | 1,000,000 | 64,000 | — |
| `gpt-5-6-sol` | GPT-5.6 Sol | 1,000,000 | 64,000 | — |
| `gpt-5-6-sol-fast` | GPT-5.6 Sol Fast | 1,000,000 | 64,000 | — |
| `gpt-5-6-terra` | GPT-5.6 Terra | 1,000,000 | 64,000 | — |
| `gpt-5-6-terra-fast` | GPT-5.6 Terra Fast | 1,000,000 | 64,000 | — |
| `grok-4-5-low` | Grok 4.5 Low | 500,000 | 64,000 | — |
| `grok-4-5-medium` | Grok 4.5 Medium | 500,000 | 64,000 | — |
| `grok-4-5-high` | Grok 4.5 High | 500,000 | 64,000 | — |
| `kimi-k2-6` | Kimi K2.6 | 262,144 | 64,000 | — |
| `kimi-k2-7` | Kimi K2.7 | 262,144 | 64,000 | — |
| `nemotron-3-ultra-nvfp4` | Nemotron 3 Ultra | 262,144 | 64,000 | — |
| `swe-1-6` | SWE-1.6 | 200,000 | 64,000 | — |
| `swe-1-6-fast` | SWE-1.6 Fast | 200,000 | 64,000 | — |
| `swe-1-7` | SWE-1.7 Max | 262,000 | 64,000 | — |
| `swe-1-7-lightning` | SWE-1.7 Lightning | 202,752 | 64,000 | — |

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Listening port |
| `HOST` | `0.0.0.0` | Listening address |
| `DEVIN_API_KEY` | Unset | Devin session token; takes precedence over the token file |
| `DEVIN_GATEWAY_CONFIG_DIR` | `~/.devin-gateway` | Token configuration directory |
| `DEVIN_BASE_URL` | Unset | Override for the Devin API base URL |

## API examples

### OpenAI Chat Completions

```bash
curl http://localhost:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer devin-session-token$xxxx' \
  -d '{"model":"claude-opus-4-8","messages":[{"role":"user","content":"Hello"}]}'
```

Streaming response:

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

## Programmatic usage

The gateway is also importable as a TypeScript library, so GitHub Actions or other scripts can call Devin directly without going through the HTTP server.

```ts
import { chat, listModels } from "devin-gateway";

const { text, toolCalls, finishReason } = await chat({
  token: process.env.DEVIN_TOKEN, // or set DEVIN_API_KEY
  model: "claude-opus-4-8",
  messages: [{ role: "user", content: "Summarize this PR" }],
});

for (const m of listModels()) console.log(m.id, m.contextWindow);
```

Importing the package does **not** start the server. To run the server programmatically:

```ts
import { startServer } from "devin-gateway";
const handle = await startServer({ port: 3000 });
// ... later
await handle.stop();
```

`chat()` only needs the Bun runtime when reading the token file; pass `token` explicitly and it runs under plain Node.js too, which makes it suitable for GitHub Actions runners. Lower-level building blocks (`streamChat`, `discoverModels`, `getUserJwt`, converters, model catalog) are all re-exported from the package entry point.

## GitHub Actions

A reusable workflow at `.github/workflows/devin-chat.yml` turns Devin into a model provider for any repository's CI — no HTTP server, no port management. Pass the token via `secrets` and the prompt via `with`, then read the reply from job outputs.

See **[docs/github-actions.md](docs/github-actions.md)** for the full guide: inputs, outputs, secret setup, and ready-to-use examples (PR review, commit message generation, multi-step pipelines). A Chinese version is available at **[docs/github-actions.zh-CN.md](docs/github-actions.zh-CN.md)**.

## Architecture

```text
Client (Cherry Studio, etc.)
    │  OpenAI / Anthropic format
    ▼
Devin Gateway (Bun + handwritten Protobuf)
    │  Connect protocol (Protobuf over HTTP)
    ▼
Devin / Windsurf Cascade API
```

Key files:

- `src/proto.ts`: minimal Protobuf codecs for the required messages
- `src/devin.ts`: Devin API client for GetUserJwt and streaming GetChatMessage
- `src/models.ts`: model catalog and workload routing
- `src/convert.ts`: conversion between OpenAI, Anthropic, and Devin formats
- `src/config.ts`: token file access and live reload
- `src/login.ts`: OAuth PKCE login flow
- `src/cli/login.ts`: command-line login tool
- `src/server.ts`: HTTP server and compatibility endpoints
- `src/client.ts`: high-level `chat()` client for programmatic/Actions use
- `src/index.ts`: public entry point — re-exports the API, starts the server when run directly

## License

Released under the [MIT License](LICENSE).
