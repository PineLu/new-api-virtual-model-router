---
changelogVersion: 1
plugin: virtual-model-router
version: 0.2.0
locale: zh-CN
---
# Changelog

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
