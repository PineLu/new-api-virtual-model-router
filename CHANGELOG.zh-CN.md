---
changelogVersion: 1
plugin: virtual-model-router
version: 0.2.1
locale: zh-CN
---
# Changelog

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
