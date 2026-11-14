# New API Virtual Model Router（虚拟模型路由插件）

[English](README.md)

**当前阶段：v0.3.5 回退轨迹已在 rc.51 三协议实测通过；webhook 经实测在 rc.51 上不可用（provider hook 无 utils.fetch）。36 项单元测试通过；真实提供商稳定性和差异化计费尚未验证，暂不视为生产就绪。**

## 做什么

客户端只填写虚拟模型名（例如 `auto-code`）；插件从**同一个提供商、同一 Base URL、同一 API Key**下的多个真实模型中选择一个调用。

插件支持虚拟模型组以及当前渠道已启用真实模型的直接透传；清单默认公布 `auto-code`，内部支持多个真实模型；提供优先级 + 权重、HTTP 429/502/503/504 失败后的有限降级。v0.3.0 增加 Chat Completions、Anthropic Messages、OpenAI Responses 三种客户端入口，统一由 New API RelayKit 转换为 Chat Completions，再进入同一套路由核心。**不做**协议编解码、智能任务分类、跨渠道/跨提供商、状态熔断、成本智能路由或其他复杂策略。

## 配置方式（不需要 Fork New API）

插件 0.2.1 支持在 New API 原生「插件设置」内选择两种编辑方式：

- **可视化表格：** 四列「虚拟模型、上游模型、优先级、权重」，可以增删行；示例：[table-config.json](examples/table-config.json)。
- **JSON（兼容旧配置）：** 继续编辑原来的 `groups` 对象，已有配置无需迁移。

**重要限制：** 两种格式不会自动互转，切换配置方式不会清空旧数据，路由只使用当前选择的格式。旧渠道没有 `editorMode` 时继续使用 JSON。配置仍显示在「插件设置」下，不能只通过插件 API 移动到「路由与映射」标签。

完整说明：[双模式配置指南](docs/config-editor-modes.md)。

## 安装（需实际网关验证）

1. 确保 New API 为 v1.0.0-rc.51 或更新版本；v0.3.0 需要链式 RelayKit 转换器支持。
2. 在插件管理上传仓库中的 `plugin.js`。
3. 新建 **61 / Task Plugin** 渠道并绑定 `virtual-model-router`。
4. 渠道 Base URL 与 API Key 填写目标上游提供商信息。
5. 渠道模型列表加入 `auto-code`，**不要对别名额外配置 `model_mapping`**。
6. 在插件设置中选择表格或 JSON。表格配置见 [示例](examples/table-config.json)；旧版 JSON 配置继续使用 [groups 示例](examples/channel-config.json)。重试次数默认 1 次；最大允许重放请求大小默认 32768 字节。
7. 在 New API 中独立配置虚拟模型的售价。**插件不会按照实际选中的真实模型自动调整扣费。**
8. 当前插件清单的 `meta.models` 只公布 `auto-code`；新增对外别名需要更新插件清单并重新上传，多别名路由尚未完成实机验证。

将示例中的 `model-a`、`model-b`、`model-c` 换成**同一提供商真正支持的模型名**，不要直接使用占位符调用。

## 多协议路由（v0.3.0）

三个客户端入口最终共用同一个 OpenAI Chat 路由核心：

| 客户端入口 | New API RelayKit 转换器 | 插件收到的格式 |
|---|---|---|
| /v1/chat/completions | plugin | OpenAI Chat |
| /v1/messages | anthropic_messages_to_openai_chat_completions+plugin | OpenAI Chat |
| /v1/responses | openai_responses_to_openai_chat_completions+plugin | OpenAI Chat |

处理链路：

1. New API RelayKit 将客户端请求转换成 Chat Completions。
2. Virtual Model Router 只识别虚拟别名、选择上游模型、执行有限故障切换或真实模型直通。
3. 上游统一调用 /v1/chat/completions。
4. 上游 Chat 响应交回 RelayKit，转换为客户端原始协议。

协议转换完全复用 New API 内置能力，插件不维护 Anthropic / Responses 的编解码实现。协议特有字段和语义能否保留，取决于当前 New API 转换器的兼容程度；Thinking / Reasoning、工具调用、多轮上下文和流式输出必须在目标版本与客户端上实测。

详细设计与验证清单：[多协议路由设计](docs/multi-protocol-routing.md)。

多协议真实请求检查：运行 [测试脚本](scripts/test_protocols.py)，操作说明见 [测试指南](docs/protocol-test-script.md)。测试 Chat、Anthropic Messages、Responses 的非流式 JSON、SSE 和工具调用；无需第三方 Python SDK。

## 真实模型直通

请求模型命中虚拟模型组时，按配置的优先级和权重路由；**未命中虚拟组时直接将相同模型名转发给当前渠道的上游**，不重写模型，也不做跨虚拟组故障切换。New API 网关仍负责选择允许该模型的渠道、令牌权限、分组和鉴权，因此不需在插件内维护第二份允许列表。

例如配置虚拟模型 `deepseek-flash` 后，同渠道也可直接请求模型 `openrouter/free`，只要它已在渠道模型列表中并且用户的 API Token 有访问权限。若已配置虚拟组但无有效候选则会明确报错，不会误当直通处理。

## 路由规则

- 优先使用已启用且权重大于 0 的最高优先级候选。
- 同级按权重做概率抽样，例如 70:30；不会保证短期严格按 7:3 分配。
- 失败时先尝试没用过的同级模型，再尝试较低优先级的备用模型。
- 只有收到**可回退状态码**且尚未开始成功输出，才考虑重试；默认 `429/502/503/504`，可用 `fallbackStatuses` 自定义。成功开始输出后流式中断不会自动切换。
- 请求体超过最大重放字节数时不重试；设置 `maxRetries=0` 可完全关闭故障切换。

注意：502/504 有可能发生于上游已经执行推理之后，自动重试存在重复上游计费的风险。正式应用前应验证限流、错误处理和成本。

## 回退控制（v0.3.1）

四个可选的渠道配置项，全部默认关闭 / 保持旧行为：

| 配置项 | 默认值 | 作用 |
|---|---|---|
| `fallbackStatuses` | `[429, 502, 503, 504]` | 触发输出前回退的上游 HTTP 状态码。 |
| `cooldownSeconds` | `0`（关闭） | 对刚失败的目标做进程内短期冷却，尽力而为。 |
| `fallbackTraceEnabled` | `false` | 回退链**最终失败**时返回 `ConvertError`，其 message 末尾携带 `vmr_fallback`（别名、已尝试目标、逐跳事件）。 |
| `fallbackWebhookUrl` | `""`（关闭） | 通过宿主 `utils.fetch` 以 GET 查询参数通知；**rc.51 上不可用**（"utils.fetch is not available in convertResponse"）。 |

- 成功回退仍为原生上游响应，插件不会修改。
- 冷却表只在当前进程内，不跨实例、不跨重启共享；插件沙箱禁止用模块全局变量保存跨请求状态，因此这是**尽力而为的提示，不是熔断器**。New API 渠道级 `auto_ban` 仍是网关唯一的健康机制。
- webhook 只能发 GET，且 rc.51 的 provider hook 完全没有 `utils.fetch`，因此在该宿主上是空操作；调用结果会记录进轨迹（需开启 `fallbackTraceEnabled`），不影响路由本身。
- 由于成功回退不会再进入 `convertResponse`，**插件内轨迹只能覆盖最终失败的链路**；成功回退请依赖可选 webhook 或上游侧日志。

完整边界、取舍与验证说明：[回退可观测性](docs/fallback-observability.md)。

## 运行测试

```sh
npm test
```

测试范围：配置校验、优先级/权重、禁用候选、模型改写、tools 字段保持、重试次数、超长请求不重放、可配状态码、冷却命中与过期、回退轨迹、webhook 降级、直通不受影响。

## 限制与边界

- 不接管 New API 现有渠道调度；只在本插件绑定的单一渠道内部选择真实模型。
- 冷却为进程内短期尽力而为机制，非强一致、非持久化；不提供跨请求的严格熔断或全局失败记忆。
- 不复用其他渠道的密钥，也不保证真实模型级准确计费。
- Chat、Anthropic Messages、Responses 是 v0.3.0 当前覆盖的入口；Gemini、WebSocket 等接口暂不在范围内。
- 成功的上游 Chat JSON/SSE 通过 `nativeResponse` 交回 New API，由 RelayKit 转回客户端协议；响应中可能显示实际选中的真实模型名。
- 协议转换不保证所有厂商扩展字段无损；以实际 New API 版本的转换器能力为准。
- 运行时插件 API 行为以 [New API rc.51 插件规范](https://github.com/QuantumNous/new-api/blob/v1.0.0-rc.51/docs/plugin-api/v1.md) 为依据，真实环境仍需验证。

[New API 全局模型别名需求 #3001](https://github.com/QuantumNous/new-api/issues/3001)。

MIT License.

P0 实机验证记录：[2026-11-14 集成测试报告](docs/live-validation-2026-11-14.md)。
