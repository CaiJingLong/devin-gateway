# Agent 指南

本仓库使用 omp 管理开发流程。以下为通用约定，适用于所有 agent 会话。

## 本地私有指令

个人化、不提交到 remote 的本地指令放在 `AGENTS.local.md`（已被 `.gitignore` 忽略），通过下面的 `@` import 自动注入。该文件不存在时，omp 会原样保留此 `@` 标记，不影响会话。

@AGENTS.local.md
