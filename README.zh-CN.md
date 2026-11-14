# New API Virtual Model Router（虚拟模型路由插件）

[English](README.md)

**当前阶段：P0 原型。Node 单元测试已通过；真实 New API 插件安装、流式调用、扣费链路尚未验证，不建议直接用于生产。**

## 做什么

客户端只填写虚拟模型名（例如 `auto-code`）；插件从**同一个提供商、同一 Base URL、同一 API Key**下的多个真实模型中选择一个调用。

首版只做：虚拟模型组、优先级 + 权重、HTTP 429/502/503/504 失败后的有限降级、Chat Completions 的 JSON 和 SSE 原生透传。**不做**智能任务分类、跨渠道/跨提供商、状态熔断、成本智能路由或其他复杂策略。

## 安装（需实际网关验证）

1. 确保 New API 版本支持 Provider Plugin（建议 v1.0.0-rc.50 或更新）。
2. 在插件管理上传仓库中的 `plugin.js`。
3. 新建 **61 / Task Plugin** 渠道并绑定 `virtual-model-router`。
4. 渠道 Base URL 与 API Key 填写目标上游提供商信息。
5. 渠道模型列表加入 `auto-code`，**不要对别名额外配置 `model_mapping`**。
6. 插件渠道配置字段 `groups` 按 [示例](examples/channel-config.json) 的 `groups` 对象填写。重试次数默认 1 次；最大允许重放请求大小默认 32768 字节。
7. 在 New API 中独立配置虚拟模型的售价。**插件不会按照实际选中的真实模型自动调整扣费。**

将示例中的 `model-a`、`model-b`、`model-c` 换成**同一提供商真正支持的模型名**，不要直接使用占位符调用。

## 路由规则

- 优先使用已启用且权重大于 0 的最高优先级候选。
- 同级按权重做概率抽样，例如 70:30；不会保证短期严格按 7:3 分配。
- 失败时先尝试没用过的同级模型，再尝试较低优先级的备用模型。
- 只有收到 **429/502/503/504 HTTP 响应**且尚未开始成功输出，才考虑重试。成功开始输出后流式中断不会自动切换。
- 请求体超过最大重放字节数时不重试；设置 `maxRetries=0` 可完全关闭故障切换。

注意：502/504 有可能发生于上游已经执行推理之后，自动重试存在重复上游计费的风险。正式应用前应验证限流、错误处理和成本。

## 运行测试

```sh
npm test
```

测试范围：配置校验、优先级/权重、禁用候选、模型改写、tools 字段保持、重试次数、超长请求不重放。

## 限制与边界

- 不接管 New API 现有渠道调度；只在本插件绑定的单一渠道内部选择真实模型。
- 不复用其他渠道的密钥，也不保证真实模型级准确计费。
- 成功的 OpenAI Chat Completions JSON/SSE 使用 `nativeResponse` 透传，因此响应中可能直接出现真实模型名。
- 不支持 Responses API、Claude Messages、WebSocket 等接口（后续版本可评估）。
- 运行时插件 API 行为以 [官方规范](https://github.com/QuantumNous/new-api/blob/main/docs/plugin-api/v1.md) 为依据，真实环境仍需验证。

[New API 全局模型别名需求 #3001](https://github.com/QuantumNous/new-api/issues/3001)。

MIT License.
