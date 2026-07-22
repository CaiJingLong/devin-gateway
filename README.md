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

Sign in on the host with `bun run login`, then start the container:

```bash
docker compose up -d --build
docker compose ps
```

Compose mounts the host configuration directory into the container. A later login updates the running container without a restart.

You can also provide the token through an environment variable:

```bash
DEVIN_API_KEY='devin-session-token$xxxx' docker compose up -d
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

## License

Released under the [MIT License](LICENSE).
