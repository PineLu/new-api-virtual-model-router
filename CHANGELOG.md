---
changelogVersion: 1
plugin: virtual-model-router
version: 0.1.1
locale: en
translations:
  zh-CN: CHANGELOG.zh-CN.md
---
# Changelog

## [0.1.1]

### Fixed

- Supply an empty model list to prevent the New API rc.51 channel picker from reading null.length.

## [0.1.0]

### Added

- Prototype virtual model groups with priority and weighted selection.
- Bounded pre-response HTTP fallback.
- Native OpenAI Chat Completions JSON/SSE passthrough and unit tests.
