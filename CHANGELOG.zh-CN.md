---
changelogVersion: 1
plugin: virtual-model-router
version: 0.3.2
locale: zh-CN
---
# Changelog

## [0.3.2]

### Fixed

- `fallbackTraceEnabled`：轨迹改为追加到错误**消息**末尾（`... | vmr_fallback={...}`），不再作为同级 JSON 字段。rc.51 实机验证显示网关会按固定 error schema 重建非 2xx 响应，`body.vmr_fallback` 会被静默丢弃。成功回退仍不改动响应。
- `fallbackWebhookUrl`：回退事件改为 **GET + 查询参数**。Plugin API v1 契约规定只有 login/refresh/revoke/exchangeKey/scheduled/ingress/egress/reply/report 这几类 hook 允许带 body 的 POST，因此 `convertResponse` 里原来的 POST 永远不会发出。现在每次调用结果（`{ok,status}` 或 `{ok:false,error}`）都会记录进轨迹，失败可观测而非静默。

### Compatibility

- 两个选项均为可选且默认关闭，现有渠道行为不变。
- webhook 接收方需支持 GET + 查询参数，而不是 JSON POST body。宿主 SSRF 检查仍然生效，仅公网地址可用。
- 需同时开启 `fallbackTraceEnabled` 才能看到 webhook 调用结果；否则响应不变。

## [0.3.1]

### Added

- 新增 `fallbackStatuses` 配置，可自定义触发回退的上游状态码（默认 `429, 502, 503, 504`）；配置非法或为空时回退到默认值。
- 新增可选 `cooldownSeconds`：对返回可回退状态码的上游目标做进程内尽力而为的短期冷却，`0`（默认）表示关闭。
- 新增可选 `fallbackTraceEnabled`：回退链最终失败时，在错误响应中附带 `vmr_fallback`（别名、已尝试目标、逐跳事件）。
- 新增可选 `fallbackWebhookUrl`：通过宿主 `utils.fetch` 尽力而为地上报每次回退事件，留空（默认）即关闭。
- 新增 14 项单元测试；所有新选项均为可选，缺省时 v0.3.0 行为完全不变。

### Migration

- 不涉及计费、价格或既有配置变更；四个新选项均提供向后兼容的默认值，现有渠道无需任何修改即可保持原行为。
- `cooldownSeconds` 与 `fallbackWebhookUrl` 仅为尽力而为：冷却表位于进程内，不跨实例、不跨重启共享；webhook 依赖宿主提供 `utils.fetch` 并放行目标地址。两者都不构成正确性保证。

## [0.3.0]

### Added

- 新增 Anthropic Messages 与 OpenAI Responses 入口，使用 New API RelayKit 内置的 +plugin 协议转换器。
- 三种客户端协议统一进入 OpenAI Chat 路由核心；协议转换不由插件重复实现。
- 保留既有 Chat 路由、权重选择、有限故障切换和真实模型直通行为。

### Compatibility

- 需要支持 <converter>+plugin 链式 RelayKit 转换的 New API Provider Plugin API，当前目标版本为 v1.0.0-rc.51。
- Anthropic / Responses 的协议特有能力仍取决于 RelayKit 的转换覆盖范围，必须进行实机集成验证。

## [0.2.1]

### Added

- 真实模型直通：不在虚拟模型组中的请求模型，直接透传至已被网关选中的渠道。
- 真实模型调用失败不会切入无关虚拟模型组；保留原有优先级和权重路由。

## [0.2.0]

### Added

- 基于 New API 原生插件 Schema，新增可视化模型路由表和 JSON 双模式，零 Fork。
- 兼容旧版 JSON 模型组配置。

### Limitations

- 两种模式的数据不会自动同步，配置仍位于插件设置。

## [0.1.2]

### Fixed

- 在 `meta.models` 中显式公布 `auto-code`，修复 New API rc.51 创建渠道时的模型元数据空值崩溃。

### Added

- 完成 New API rc.51 配合模拟上游的 P0 集成验证。
