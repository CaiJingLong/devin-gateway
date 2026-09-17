# 更新日志

devin-gateway 的版本变更记录。0.7.0 之前的历史见 [GitHub Releases](https://github.com/CaiJingLong/devin-gateway/releases)。

## 0.7.0（2026-09-17）

### 新功能

- **`GET /v1/models` 透传模型能力元数据**：每条模型条目新增 `context_window`、`max_tokens`、`reasoning`、`supports_images`，`?source=local` 与远程发现两条路径返回结构一致。客户端（Cherry Studio 等）可直接据此判断上下文长度、最大输出、思考与图片能力。
- **内置目录按账号目录重新生成**（`?source=local` 与离线启动使用）：来源 `devin models list --format json`（CLI 3000.10.31）/ `GetCliModelConfigs` proto，快照 2026-09-17，共 209 条（原 126 条）。字段映射与再生成方式写在 `src/models.ts` 顶部注释。
- 新增模型家族：Claude Opus 5（含 Fast）、Claude Fable 5.1、GPT-6 Astra、GPT-5.6 Sol / Luna / Terra 新条目、Gemini 3.6 / 3.7 / 3.8 Flash、GLM-5.3（含 Flash）、Grok 4.6、Kimi K3、Inkling、DeepSeek V4 Pro / V4 Flash / V4.1 Flash、Nemotron 3 Ultra、SWE-1.7 Lightning、SWE-2，以及 Claude 4.5 / 4.6 与 GPT-5.1 的思考变体。

### 修复

- **模型最大输出不再被恒定截断为 64K**：此前 `maxTokens` 取自 `max_context_tokens`（`ClientModelConfig` 字段 18）并 clamp 到 64K，现改读 `ModelInfo.max_output_tokens`（字段 23 → 内层 13），返回上游真实值（128K / 384K / 131,072 / 65,535 等），仅在上游缺省时回落到 64K。126 条既有条目中 124 条因此修正。
- **`supports_images` 与上下文窗口按各自字段解析**：上下文窗口固定取字段 18，图片能力取字段 5，不再与输出上限共用同一字段。
- **`ModelInfo` 只解析一次**：`max_output_tokens` 与 `model_features.supports_thinking` 合并进单次扫描（`parseModelInfo`），避免重复遍历。
- **旧目录 ID 变更**：`deepseek-v4`、`nemotron-3-ultra-nvfp4` 不在新目录中，分别由 `deepseek-v4-pro-high|max`、`nemotron-3-ultra-none|medium|high` 取代。网关仍原样透传未知 ID，受影响的只有 `?source=local` 列表。

### 文档

- README / README.zh-CN.md 的模型快照表更新到 2026-09-17，并注明目录再生成方式。

### 测试

- 全量 277 pass / 17 skip / 0 fail。

### 升级

```
docker pull ghcr.io/caijinglong/devin-gateway:0.7.0
docker pull kikt69/devin-gateway:0.7.0
```

客户端重新拉取 `GET /v1/models` 即可看到新增能力字段与新模型。
