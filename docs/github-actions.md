# GitHub Actions

This repo ships a reusable workflow, `.github/workflows/devin-chat.yml`, that turns Devin/Windsurf Cascade into a model provider you can call from any repository's CI. Callers don't need to install Bun, write scripts, or run an HTTP server — the workflow checks out this repo, sets up Bun, runs `scripts/chat.ts`, and surfaces the model's reply as a job output.

## How it works

```
Caller workflow
    │  uses: caijinglong/devin-gateway/.github/workflows/devin-chat.yml@<ref>
    │  secrets: DEVIN_TOKEN
    │  with:   prompt / model / ...
    ▼
devin-chat.yml (reusable workflow)
    │  checkout this repo → setup-bun → bun run scripts/chat.ts
    ▼
scripts/chat.ts → chat() → Devin/Cascade API
    │  reply written to $GITHUB_OUTPUT (response, finish_reason)
    ▼
Caller consumes via needs.<job>.outputs.response
```

No HTTP server is started, no port is bound, and each call returns in one shot. `chat()` doesn't touch Bun-specific file APIs when the token is passed explicitly, so it runs fine on an Actions runner.

## Prerequisites

### 1. Obtain a Devin token

The workflow needs the **full string value** of the token (shaped like `devin-session-token$xxxx...`) to put into a GitHub secret. Pick whichever method fits your environment.

> An active Devin or Windsurf subscription is required. This gateway provides no account, subscription, or usage quota.

#### Option A: Local browser login (recommended, desktop environment)

```bash
git clone https://github.com/caijinglong/devin-gateway.git
cd devin-gateway
bun install
bun run login
```

A browser opens automatically to complete OAuth; the token is written to `~/.devin-gateway/token`. Read the string value:

```bash
cat ~/.devin-gateway/token
```

Or print it without saving to disk:

```bash
bun run login -- --print
```

#### Option B: Paste the callback URL (SSH / headless / remote)

When the machine can't receive a browser callback (SSH, container, headless server), use paste mode to paste it manually:

```bash
bun run login:paste
```

Open the printed auth URL, complete sign-in in the browser, then paste the callback URL from the address bar (shaped like `http://127.0.0.1:59653/callback?code=...&state=...`) back into the terminal. Add `--print` to only print the token:

```bash
bun run login:paste -- --print
```

#### Option C: Web login (gateway already running locally)

Start the server and open `http://localhost:3000/login` in a browser. After authorization the token is written to the same file. If the callback can't reach your machine (remote deployment), the page has a paste form — paste the callback URL there.

#### Option D: Inspect an existing token

```bash
bun run login:status     # shows token status (prefix + presence)
cat ~/.devin-gateway/token   # read the full value directly
```

#### About the DEVIN_API_KEY env var

`DEVIN_API_KEY` is a server-side override for the gateway — it is **not** a way to obtain a token. The workflow calls `chat()`, which reads `DEVIN_TOKEN` (the script input) or the `DEVIN_API_KEY` env var — but in Actions you should pass it via `secrets.DEVIN_TOKEN`, never as a plaintext env var.

### 2. Configure the secret in the calling repo

In the calling repo, go to Settings → Secrets and variables → Actions → New repository secret:

- Name: `DEVIN_TOKEN`
- Value: the full token from the previous step (including the `devin-session-token$` prefix)

Organization-level secrets work too. Rotate the token periodically.

### 3. Pin the workflow ref

Pin `@<ref>` in `uses:` to a specific tag (e.g. `@v0.3.0`) or commit SHA so upstream changes don't surprise your CI. `@main` is fine for early experimentation but not recommended long-term.

## Inputs

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `prompt` | string | yes | — | User prompt |
| `system` | string | no | `""` | System prompt |
| `model` | string | no | `glm-5-2` | Cascade model UID; see [Models](../README.md#models) |
| `max-tokens` | number | no | `0` | Max output tokens; `0` uses the server default |
| `temperature` | number | no | `0` | Sampling temperature; `0` uses the server default |
| `top-p` | number | no | `0` | Top-p; `0` uses the server default |
| `base-url` | string | no | `""` | Override the Devin API base URL; empty uses the default |

### Secret

| Secret | Required | Description |
| --- | --- | --- |
| `DEVIN_TOKEN` | yes | Devin session token (`devin-session-token$...`) |

## Outputs

| Output | Description |
| --- | --- |
| `response` | Model reply text (may be multi-line; encoded with a delimiter for safety) |
| `finish_reason` | OpenAI-style finish reason (`stop` / `tool_calls` / ...) |

## Minimal example

```yaml
name: Ask Devin

on:
  pull_request:
    types: [opened]

jobs:
  ask-devin:
    uses: caijinglong/devin-gateway/.github/workflows/devin-chat.yml@v0.3.0
    secrets:
      DEVIN_TOKEN: ${{ secrets.DEVIN_TOKEN }}
    with:
      prompt: "Summarize this PR's changes in one sentence"

  echo:
    needs: ask-devin
    runs-on: ubuntu-latest
    steps:
      - run: echo "${{ needs.ask-devin.outputs.response }}"
```

## Real-world examples

### PR code review

Have the model review the diff when a PR opens and comment the result on the PR. Requires `pull-requests: write`.

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
    uses: caijinglong/devin-gateway/.github/workflows/devin-chat.yml@v0.3.0
    secrets:
      DEVIN_TOKEN: ${{ secrets.DEVIN_TOKEN }}
    with:
      system: "You are a senior code reviewer. Be concise."
      prompt: |
        Review the following PR diff. List potential bugs, risks, and improvements.
        Repo: ${{ github.event.pull_request.head.repo.full_name }}
        PR #${{ github.event.pull_request.number }}: ${{ github.event.pull_request.title }}
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
              body: `### Devin review\n\n${{ needs.review.outputs.response }}`,
            });
```

### Generate a commit message

Generate a Conventional Commits message from a diff.

```yaml
name: Devin commit message

on:
  workflow_dispatch:

jobs:
  generate:
    uses: caijinglong/devin-gateway/.github/workflows/devin-chat.yml@v0.3.0
    secrets:
      DEVIN_TOKEN: ${{ secrets.DEVIN_TOKEN }}
    with:
      system: "Output Conventional Commits format: one-line subject + optional body. No extra explanation."
      prompt: "Generate a commit message for these changes:\n\n${{ vars.RECENT_DIFF }}"
      model: "glm-5-2-max"
```

### Manual trigger with a custom model

```yaml
name: Devin on demand

on:
  workflow_dispatch:
    inputs:
      question:
        description: "Question"
        required: true

jobs:
  ask:
    uses: caijinglong/devin-gateway/.github/workflows/devin-chat.yml@v0.3.0
    secrets:
      DEVIN_TOKEN: ${{ secrets.DEVIN_TOKEN }}
    with:
      prompt: ${{ inputs.question }}
      model: "claude-opus-4-8-max"
      max-tokens: 8192
```

### Chain steps: summarize then translate

```yaml
jobs:
  summarize:
    uses: caijinglong/devin-gateway/.github/workflows/devin-chat.yml@v0.3.0
    secrets:
      DEVIN_TOKEN: ${{ secrets.DEVIN_TOKEN }}
    with:
      prompt: "Summarize this document in three bullets: ${{ vars.DOC }}"

  translate:
    needs: summarize
    uses: caijinglong/devin-gateway/.github/workflows/devin-chat.yml@v0.3.0
    secrets:
      DEVIN_TOKEN: ${{ secrets.DEVIN_TOKEN }}
    with:
      prompt: "Translate the following into English:\n\n${{ needs.summarize.outputs.response }}"
```

## Notes

- **Token security**: `DEVIN_TOKEN` must go in `secrets` — never hardcode it or put it in `with`. `scripts/chat.ts` only prints the reply to logs, never the token.
- **Pin the ref**: use a tag or SHA in production; `@main` drifts with upstream.
- **Concurrency**: each reusable-workflow call is an independent job with no port or state conflicts, so calls can run concurrently.
- **Timeout**: the default job timeout is 360 minutes (the GitHub cap). Long Devin replies can take a while — set `timeout-minutes` on the calling job if needed.
- **Model availability**: the `model` input is not validated against the catalog — unknown UIDs pass straight through to the Devin API. Catalog ids are listed in the main README's "Models" section, but that list may change at any time and is **not a constraint on the workflow**; trust `GET /v1/models?source=remote` for the live set.
- **Bun version**: the workflow uses `latest` from `oven-sh/setup-bun@v2`; fork this repo and pin it if you need a fixed version.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `DEVIN_TOKEN is required` | The calling repo has no `DEVIN_TOKEN` secret, or the `secrets:` mapping is wrong |
| `Devin API 401/403` | Token expired or subscription lapsed — re-run `bun run login` and update the secret |
| `response` is empty | Model returned empty; check `finish_reason`, or raise `max-tokens` |
| Job timeout | Long reply or slow server; add `timeout-minutes` on the caller, or lower `max-tokens` |
| `uses` won't resolve | The ref doesn't exist or the repo isn't public; verify the tag/SHA |
