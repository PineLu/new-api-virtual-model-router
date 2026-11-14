---
changelogVersion: 1
plugin: virtual-model-router
version: 0.3.0
locale: en
translations:
  zh-CN: CHANGELOG.zh-CN.md
---
# Changelog

## [0.3.0]

### Added

- Add Anthropic Messages and OpenAI Responses client routes using New API RelayKit's built-in +plugin converters.
- Normalize all supported client protocols to the same OpenAI Chat routing core; keep protocol conversion outside the plugin.
- Preserve existing Chat routing, weighted selection, bounded fallback and real-model passthrough.

### Compatibility

- Requires a New API build whose Provider Plugin API supports chained RelayKit converters (<converter>+plugin), such as v1.0.0-rc.51.
- Anthropic/Responses protocol-specific behavior still depends on RelayKit conversion coverage and requires live integration validation.

## [0.2.1]

### Added

- Pass through real upstream models that New API has already selected for the channel, while preserving virtual-model group routing.
- Keep direct-model failures isolated: they do not retry into unrelated virtual groups.

## [0.2.0]

### Added

- Visual flat-row model routing configuration via New API's native plugin settings schema, with JSON/legacy mode selector and no New API fork.
- Backward compatible JSON groups and new table configuration example.

### Limitations

- Modes retain independent values, do not automatically synchronize, and remain under Plugin settings.

## [0.1.2]

### Fixed

- Advertise `auto-code` in `meta.models` so the New API rc.51 channel picker no longer crashes on null model metadata.

### Added

- Live P0 integration verification against New API rc.51 with a mock upstream.
