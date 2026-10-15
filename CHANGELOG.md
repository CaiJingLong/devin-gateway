# 更新日志

devin-gateway 的版本变更记录。0.7.0 之前的历史见 [GitHub Releases](https://github.com/CaiJingLong/devin-gateway/releases)。

## 0.7.1（2026-10-15）

### 修复

- **工具调用参数正确拼接并保持实时输出**：修复 Cascade 匿名及重复 ID 参数分片被拆分或覆盖的问题。Chat Completions 使用稳定的工具调用 `index`，Anthropic Messages 在同一个 `tool_use` 内容块内持续输出参数增量；非流式响应与 `chat()` 返回完整且经过校验的参数。关联 [#1](https://github.com/CaiJingLong/devin-gateway/issues/1)、[#2](https://github.com/CaiJingLong/devin-gateway/pull/2)。
- **异常流正确结束**：参数无效、Connect 帧截断或上游报错时，HTTP 流以错误结束，不发送成功结束标志；流提前退出时清理读取器和计时器。无参数工具归一化为 `{}`。
- **统一官方 CLI 客户端标识**：认证、聊天及模型发现统一使用 `chisel`，修复部分模型报错 “This model is only in Devin Local” 的问题，同时保留完整远程模型目录。关联 [#3](https://github.com/CaiJingLong/devin-gateway/pull/3)。

### 使用说明

- 工具参数分片随到随发，不等待整个响应结束。直接使用 `streamChat()` 的调用方需按 `toolCalls[].index` 拼接 `argumentsJson`，并在成功完成后执行工具；任何错误事件均应视为失败。
- README 与中文 README 补充工具调用的流式行为及错误处理说明。

### 验证

- 全量测试：313 pass / 17 skip / 0 fail；跳过项为需要凭据的集成测试。类型检查和构建通过。
- 工具调用真实上游实测：直接流式调用、Chat Completions 与 Anthropic Messages 的流式及非流式路径共 5 项通过。
- 最终客户端标识实测：模型发现返回 265 项；`gpt-6-luna-none` 和 `glm-5-2-none` 聊天成功。

### 升级

```sh
docker pull ghcr.io/caijinglong/devin-gateway:0.7.1
docker pull kikt69/devin-gateway:0.7.1
```

重新创建容器以使用新镜像。镜像支持 `linux/amd64` 和 `linux/arm64`。

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
