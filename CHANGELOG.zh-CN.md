---
changelogVersion: 1
plugin: virtual-model-router
version: 0.3.0
locale: zh-CN
---
# Changelog

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
