# New API Virtual Model Router

[简体中文](README.zh-CN.md)

A lightweight **Provider Plugin API v1** for [New API](https://github.com/QuantumNous/new-api). Routes one virtual alias (for example `auto-code`) to multiple real models served by **the same provider, Base URL and API key**.

> **Status: v0.3.1 adds configurable retryable statuses, an optional best-effort cooldown and fallback tracing, and passes 36 unit tests.** The Anthropic/Responses routes and the new options still require live rc.51 integration tests; real-provider reliability and accurate per-target billing are not verified.

## Current scope

- Virtual model aliases with multiple real upstream targets, plus transparent passthrough of directly requested models already selected by the New API gateway.
- Highest priority first; weighted random selection within equal priority.
- Disable a target via `enabled: false` or `weight: 0`.
- Optional bounded fallback before a successful response starts; the retryable status list is configurable (`fallbackStatuses`, default `429, 502, 503, 504`).
- OpenAI Chat Completions, Anthropic Messages and OpenAI Responses client routes, all converging on one OpenAI Chat routing core through New API RelayKit.
- OpenAI Chat JSON/SSE passthrough, including tool calls; protocol conversion is owned by New API, not reimplemented in this plugin.
- Single-file `plugin.js`, no external services and no New API fork.

## Plugin-only editor (no New API fork)

Plugin 0.2.1 adds a **Visual table** mode under native Plugin settings, with columns for public alias, upstream model, priority, and weight. JSON mode keeps the original `groups` object. Old saved channels without `editorMode` continue to use JSON; existing values are preserved.

**Both editors share one routing table:** the active mode's own field wins, and when it is empty the other format is used, so maintaining a single side is enough and switching editors never disables routing. New API's native Routing & Mapping tab is not extensible by the current Provider Plugin API.

See [editor guide](docs/config-editor-modes.md) and [table config example](examples/table-config.json).

## Configuration

1. Use New API >= v1.0.0-rc.51; v0.3.0 requires chained RelayKit converter support.
2. Install `plugin.js` in the plugin manager.
3. Create a type-61 Task Plugin channel bound to `virtual-model-router`.
4. Supply the real provider's Base URL and API key.
5. Add the alias `auto-code` to the channel model list. **Do not set model_mapping**.
6. Set plugin channel config: `groups` is an object keyed by alias (see [example](examples/channel-config.json)); `maxRetries` defaults to 1 and `maxReplayBytes` to 32768. All v0.3.1 options are optional — see [fallback observability](docs/fallback-observability.md).
7. Verify the virtual model's pricing in New API. This plugin **does not** override gateway billing.
8. The manifest currently advertises only `auto-code` in `meta.models`; adding new public aliases currently requires updating the manifest and re-uploading. Multiple-alias support is not yet live-tested.

## Multi-protocol routing (v0.3.0)

The plugin declares three client routes, all targeting the same upstream Chat Completions endpoint:

| Client endpoint | New API RelayKit converter | Plugin routing format |
| --- | --- | --- |
| /v1/chat/completions | plugin | OpenAI Chat |
| /v1/messages | anthropic_messages_to_openai_chat_completions+plugin | OpenAI Chat |
| /v1/responses | openai_responses_to_openai_chat_completions+plugin | OpenAI Chat |

RelayKit converts the client request into Chat Completions before convertRequest. The plugin only performs alias resolution, weighted selection, fallback and real-model passthrough. The upstream Chat response is handed back to RelayKit, which converts it to the client's original protocol. The same routing configuration therefore applies to all three entry points.

This reuses New API's built-in converters; the plugin does not implement Anthropic or Responses codecs. Protocol-specific fields and semantics are only as compatible as the host converter. In particular, verify thinking/reasoning, tool calls, multi-turn state and streaming behavior against the exact New API build and client.

See [multi-protocol routing design and validation](docs/multi-protocol-routing.md). Run [the protocol test script](scripts/test_protocols.py) against New API using an environment-provided API key; see the [test guide](docs/protocol-test-script.md). It validates JSON, SSE, and function/tool calling for all three protocols.

## Fallback controls (v0.3.1)

Four optional channel settings, all opt-in with backward-compatible defaults:

| Option | Default | Purpose |
| --- | --- | --- |
| `fallbackStatuses` | `[429, 502, 503, 504]` | Upstream HTTP statuses that trigger pre-output fallback. |
| `cooldownSeconds` | `0` (off) | Best-effort in-process pause before reusing a target that just failed. |
| `fallbackTraceEnabled` | `false` | On terminal failure return a `ConvertError` whose message ends with `vmr_fallback` (alias / attempted / per-hop events). |
| `fallbackWebhookUrl` | `""` (off) | Best-effort GET notification via host `utils.fetch`; **not available on rc.51** ("utils.fetch is not available in convertResponse"). |

Successful fallbacks stay native and are never modified. The cooldown table is in-process only (not shared across instances or restarts), The webhook is GET-only (provider hooks cannot POST) and, on rc.51, provider hooks have no `utils.fetch` at all, so it is a no-op there. Neither option is a correctness guarantee. Full boundaries, rationale and verification notes: [fallback observability](docs/fallback-observability.md).

## Direct model passthrough

The plugin only rewrites models whose names match a configured virtual group. For any other model selected by New API for this channel, the upstream request retains the original model string. The gateway still controls channel-model eligibility and API token/group authorization. Passthrough requests do **not** retry against virtual-model candidates, even if their upstream returns 429. Malformed configured groups fail closed rather than bypassing routing.

## Limitations

Does not route across existing New API channels or provider credentials. Does not implement intelligent task classification, persistent round robin, sticky sessions, or cost-based model selection. The optional cooldown is a short-lived, in-process best-effort hint rather than a circuit breaker; New API's own channel-level `auto_ban` remains the only gateway health mechanism. Requests exceeding `maxReplayBytes` are never replayed. In-flight failed streams are never restarted. HTTP 502/504 may follow an upstream execution that incurred cost, so retry can cause duplicate upstream charges.

Successful upstream responses expose the **actual target model name** for diagnosis. The upstream Chat JSON/SSE and usage remain native; New API converts them for the client. Because a successful failover never re-enters `convertResponse`, **only failed chains can carry an in-plugin trace** — use the optional webhook or upstream-side logs for successful failovers. New API billing uses its own configured pricing; exact per-target settlement is **not** guaranteed.

Run tests: `npm test`.

References: [Plugin API v1](https://github.com/QuantumNous/new-api/blob/v1.0.0-rc.51/docs/plugin-api/v1.md), [global model alias issue](https://github.com/QuantumNous/new-api/issues/3001).

MIT licensed.

P0 live testing: [2026-11-14 integration report](docs/live-validation-2026-11-14.md).
