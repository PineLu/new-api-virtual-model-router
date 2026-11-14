# New API Virtual Model Router

[简体中文](README.zh-CN.md)

A lightweight **Provider Plugin API v1** for [New API](https://github.com/QuantumNous/new-api). Routes one virtual alias (for example `auto-code`) to multiple real models served by **the same provider, Base URL and API key**.

> **Status: P0 integration-tested on New API rc.51 with a local mock upstream; not production ready.** Real providers and accurate per-target billing are not verified.

## V1 scope

- A single advertised P0 alias (`auto-code`) with multiple real upstream targets.
- Highest priority first; weighted random selection within equal priority.
- Disable a target via `enabled: false` or `weight: 0`.
- Optional bounded fallback for HTTP 429, 502, 503, 504 before a successful response starts.
- OpenAI Chat Completions JSON and SSE passthrough, including tool calls.
- Single-file `plugin.js`, no external services and no New API fork.

## Plugin-only editor (no New API fork)

Plugin 0.2.0 adds a **Visual table** mode under native Plugin settings, with columns for public alias, upstream model, priority, and weight. JSON mode keeps the original `groups` object. Old saved channels without `editorMode` continue to use JSON; existing values are preserved.

**Mode switching is not data conversion:** table and JSON keep separate values; only the selected mode drives routing. New API's native Routing & Mapping tab is not extensible by the current Provider Plugin API.

See [editor guide](docs/config-editor-modes.md) and [table config example](examples/table-config.json).

## Configuration

1. Use New API >= v1.0.0-rc.50 with Provider Plugin support.
2. Install `plugin.js` in the plugin manager.
3. Create a type-61 Task Plugin channel bound to `virtual-model-router`.
4. Supply the real provider's Base URL and API key.
5. Add the alias `auto-code` to the channel model list. **Do not set model_mapping**.
6. Set plugin channel config: `groups` is an object keyed by alias (see [example](examples/channel-config.json)); `maxRetries` defaults to 1 and `maxReplayBytes` to 32768.
7. Verify the virtual model's pricing in New API. This plugin **does not** override gateway billing.
8. P0 advertises only `auto-code` in `meta.models`; adding new public aliases currently requires updating the manifest and re-uploading. Multiple-alias support is not yet live-tested.

## Limitations

Does not route across existing New API channels or provider credentials. Does not implement intelligent task classification, persistent round robin, sticky sessions, circuit breakers, or cost-based model selection. Requests exceeding `maxReplayBytes` are never replayed. In-flight failed streams are never restarted. HTTP 502/504 may follow an upstream execution that incurred cost, so retry can cause duplicate upstream charges.

Successful upstream responses expose the **actual target model name** for diagnosis. The upstream JSON/SSE and usage remain native, but New API billing uses its own configured pricing; exact per-target settlement is **not** guaranteed.

Run tests: `npm test`.

References: [Plugin API v1](https://github.com/QuantumNous/new-api/blob/main/docs/plugin-api/v1.md), [global model alias issue](https://github.com/QuantumNous/new-api/issues/3001).

MIT licensed.

P0 live testing: [2026-11-14 integration report](docs/live-validation-2026-11-14.md).
