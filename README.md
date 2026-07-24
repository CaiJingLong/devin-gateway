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
- OAuth login CLI (`bun run login`) to obtain a Devin token
- Per-request credentials: clients pass their own token via `Authorization` or `x-api-key`
- No third-party runtime dependencies; Protobuf encoding and decoding are implemented in the project

## Quick start

### 1. Sign in to Devin

```bash
bun install
bun run login
```

A browser window opens automatically. After sign-in, the token is printed and stored at `~/.devin-gateway/token`. Copy it into your client's API key field.

Other CLI options:

```bash
bun run login:paste       # Paste the callback URL manually
bun run login:status      # Show the current saved token status
bun run login -- --print  # Print the token without saving it
```

### 2. Start the gateway

```bash
bun run start
```

The gateway listens on `http://localhost:3000` by default. It holds no token state — each request must carry credentials via `Authorization: Bearer <token>` (OpenAI clients) or `x-api-key: <token>` (Anthropic clients). Set `DEVIN_API_KEY` only if you want a fallback for requests that omit both headers.

### Docker

The published image supports `linux/amd64` and `linux/arm64`. Sign in on the host with `bun run login` before starting it.

#### `docker run`

```bash
docker run -d \
  --name devin-gateway \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  ghcr.io/caijinglong/devin-gateway:0.4.0
```

Clients send their own Devin token per request, so no token volume is needed. Set `DEVIN_API_KEY` only if you want a server-side fallback.

#### Docker Compose

Create `compose.yaml`:

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

A successful login writes the token to `~/.devin-gateway/token` and prints it. Copy the printed token into your client's API key field.

### Environment variable (optional server fallback)

Set `DEVIN_API_KEY` to provide a fallback token for requests that omit `Authorization`/`x-api-key` headers. This is optional — the common case is for each client to send its own token.

## Cherry Studio configuration

### OpenAI mode

| Setting | Value |
| --- | --- |
| API base URL | `http://localhost:3000/v1` |
| API key | Your Devin token |
| Model | Read from `GET /v1/models`, for example `claude-opus-4-8-low` or `gpt-5-5-none` |

### Anthropic mode

| Setting | Value |
| --- | --- |
| API base URL | `http://localhost:3000` |
| API key | Your Devin token |
| Model | Same list as OpenAI mode |

## Models

The built-in catalog covers Claude, GPT, Gemini, GLM, Grok, Kimi, DeepSeek, SWE, and related model families.

```bash
# Current models reported by the Devin API; requires a valid token
curl http://localhost:3000/v1/models

# Built-in snapshot bundled with this gateway
curl 'http://localhost:3000/v1/models?source=local'
```

> **Note**: `/v1/models` loads the live Devin catalog by default; `?source=remote` is an explicit equivalent. The table below is a snapshot of the built-in catalog at the time shown. Devin's available models change at any time, so this list is **for reference only and is not a constraint on the workflow** — `model` accepts any raw Cascade UID and passes unknown UIDs straight through. Use `GET /v1/models` for the live list.

**Snapshot time: 2026-07-23**

| Model id | Name | Context window | Max tokens |
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

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Listening port |
| `HOST` | `0.0.0.0` | Listening address |
| `DEVIN_API_KEY` | Unset | Optional fallback token used only when a request omits `Authorization`/`x-api-key` |
| `DEVIN_BASE_URL` | Unset | Override for the Devin API base URL |

## API examples

```bash
curl http://localhost:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer devin-session-token$xxxx' \
  -d '{"model":"claude-opus-4-8-low","messages":[{"role":"user","content":"Hello"}]}'
```

Streaming response:

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

## Programmatic usage

The gateway is also importable as a TypeScript library, so GitHub Actions or other scripts can call Devin directly without going through the HTTP server.

```ts
import { chat, listModels } from "devin-gateway";

const { text, toolCalls, finishReason } = await chat({
  token: process.env.DEVIN_TOKEN, // or set DEVIN_API_KEY
  model: "claude-opus-4-8-low",
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

`chat()` only needs the Bun runtime when reading the token file; pass `token` explicitly and it runs under plain Node.js too, which makes it suitable for GitHub Actions runners. Lower-level building blocks (`streamChat`, `discoverModels`, `getUserJwt`, converters, model catalog) are all re-exported from the package entry point. The server itself holds no token state — clients send credentials per request.

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
- `src/config.ts`: token file read/write helpers (used by the CLI login tool; the server no longer reads it)
- `src/login.ts`: OAuth PKCE login flow
- `src/cli/login.ts`: command-line login tool
- `src/server.ts`: HTTP server and compatibility endpoints
- `src/client.ts`: high-level `chat()` client for programmatic/Actions use
- `src/index.ts`: public entry point — re-exports the API, starts the server when run directly

## License

Released under the [MIT License](LICENSE).
