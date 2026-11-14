---
changelogVersion: 1
plugin: virtual-model-router
version: 0.3.6
locale: en
translations:
  zh-CN: CHANGELOG.zh-CN.md
---
# Changelog

## [0.3.6]

### Changed

- The table (`routes`) and JSON (`groups`) editors now share one routing table: the active mode's own field wins, and when it is empty the other representation is used. Maintaining a single side is enough, and switching editors no longer disables routing.
- Schema descriptions state this fallback explicitly.
- 4 new unit tests: table→JSON and JSON→table fallback, active-mode precedence, and the non-array `routes` error.

### Compatibility

- No configuration change is required. Channels that keep both fields behave as before; a channel with only one populated side now works in both modes instead of failing in the other.

## [0.3.5]

### Fixed

- `fallbackTraceEnabled` now reaches the client on a live gateway. Live rc.51 testing showed the 0.3.2 message-suffix approach was still dropped: with `nativeResponse`, the host ignores a `{body}` returned for a non-2xx reply and honours only `{error}`/`{next}`. `attachTrace` now returns a `ConvertError` whose message carries ` | vmr_fallback={alias,attempted,events}`; verified on Chat, Anthropic Messages and Responses.

### Known limitation (measured)

- `fallbackWebhookUrl` cannot work on this host: the host reports **"utils.fetch is not available in convertResponse"**. The plugin still builds a GET attempt when the option is set and records `{ok:false,error}` on the trace, so the failure is visible instead of silent. The option is kept for hosts that do expose `fetch` to provider hooks; on rc.51 it is a no-op.

### Compatibility

- Internal diagnostic builds 0.3.3 and 0.3.4 were never released.
- 0.3.2's message-suffix trace is superseded by this release; its behaviour is otherwise unchanged.

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
