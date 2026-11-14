---
changelogVersion: 1
plugin: virtual-model-router
version: 0.3.2
locale: en
translations:
  zh-CN: CHANGELOG.zh-CN.md
---
# Changelog

## [0.3.2]

### Fixed

- `fallbackTraceEnabled`: the trace is now appended to the error **message** (`... | vmr_fallback={...}`) instead of a sibling JSON field. Live rc.51 testing showed the gateway rebuilds non-2xx bodies from a fixed error schema, so `body.vmr_fallback` was silently dropped. Successful failovers remain untouched.
- `fallbackWebhookUrl`: the fallback event is now sent as a **GET with query parameters**. The Plugin API v1 contract allows POST with a body only in login/refresh/revoke/exchangeKey/scheduled/ingress/egress/reply/report hooks, so the previous POST from `convertResponse` could never fire. Every outcome (`{ok,status}` or `{ok:false,error}`) is recorded on the trace so a failure is observable instead of silent.

### Compatibility

- Both options are opt-in and default to off; existing channels keep their behaviour.
- Webhook consumers must accept GET with query parameters instead of a JSON POST body. Host SSRF checks still apply, so only public hosts work.
- The webhook outcome is visible only with `fallbackTraceEnabled`; without it the reply is unchanged.

## [0.3.1]

### Added

- Configurable retryable upstream statuses via `fallbackStatuses` (default `429, 502, 503, 504`); invalid or empty values fall back to the defaults.
- Optional best-effort in-process `cooldownSeconds` for a target that returned a retryable status; `0` (default) disables it.
- Optional `fallbackTraceEnabled`: when a fallback chain ultimately fails, attach a `vmr_fallback` object (alias, attempted targets, per-hop events) to the error reply.
- Optional `fallbackWebhookUrl`: best-effort POST of each fallback event through the host's `utils.fetch`; empty (default) disables it.
- 14 new unit tests; all new options are opt-in, so v0.3.0 behaviour is unchanged when they are absent.

### Migration

- No pricing, billing or existing configuration changes are required. All four new options have backward-compatible defaults; existing channels keep their current behaviour without any edit.
- `cooldownSeconds` and `fallbackWebhookUrl` are best-effort only: the cooldown table is in-process and is not shared across instances or restarts, and the webhook requires the host to expose `utils.fetch` and allow the target host. Neither is a correctness guarantee.

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
