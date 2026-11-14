---
changelogVersion: 1
plugin: virtual-model-router
version: 0.2.1
locale: en
translations:
  zh-CN: CHANGELOG.zh-CN.md
---
# Changelog

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
