# Fallback configuration and observability (v0.3.1)

This document records what the three v0.3.1 additions actually deliver, and
— more importantly — what the New API Plugin API v1 sandbox prevents them from
delivering. Read it before treating any of them as a production guarantee.

## What was missing in v0.3.0

1. Retryable statuses were the hard-coded constant `FALLBACK_STATUSES = [429, 502, 503, 504]` (`plugin.js`), with no `channelConfig` field, so the settings form could not change them.
2. A target that failed was excluded only within the current request (`state.attempted`). The next request re-selected it with unchanged weight — no cooldown.
3. The plugin had no logging API and successful failovers use `nativeResponse: true`, so no explicit fallback record existed. Only `response_model.returned_model` and upstream-side logs gave indirect clues.

## What v0.3.1 adds

| Option | Type | Default | Behaviour |
| --- | --- | --- | --- |
| `fallbackStatuses` | integer array (400–599, unique) | `[429, 502, 503, 504]` | Pre-output upstream statuses that trigger fallback. Invalid, empty or non-array values fall back to the defaults, so a bad config can never silently disable fallback. |
| `cooldownSeconds` | integer 0–600 | `0` (off) | Best-effort, in-process pause before reusing a target that returned a retryable status. |
| `fallbackTraceEnabled` | boolean | `false` | When a fallback chain **ultimately fails**, attach `vmr_fallback` to the returned reply. |
| `fallbackWebhookUrl` | absolute http(s) string | `""` (off) | Best-effort POST of each fallback event through the host `utils.fetch`. |

All four are opt-in. With no new config, `convertRequest` / `convertResponse`
behave exactly as in v0.3.0 (22 pre-existing unit tests pass unchanged).

### 1. Configurable statuses — complete

`normalizeFallbackStatuses()` filters non-integers, out-of-range values and
duplicates; the validated list is stored in per-request `state` and read by
`convertResponse`. Config lives in `meta.channelConfig`, so New API renders it
in the channel settings form automatically. Status `400`/`401` remain
non-retryable unless explicitly listed.

### 2. Cooldown — best-effort only

The official Plugin API v1 contract states that plugin runtimes are pooled
across requests and that module variables must not retain arguments or nested
values after a hook returns. There is no key-value or persistent storage
exposed to relay hooks. Therefore a **reliable, shared cooldown is impossible
inside this plugin**.

The implementation is deliberately narrow:

- A module-level `Map` holds only plain scalars: `alias\u0000target -> clock value`. No request body, `ctx`, host object or nested value is retained.
- The clock uses host `utils.unixNow()` when available, else `Date.now()/1000`, else `0` (feature degrades to off). Only the **difference** between two readings is compared, so seconds vs milliseconds on the host does not matter.
- The table is bounded (256 entries) and self-prunes.
- If every candidate is cooling, the router falls back to its original choice, so cooldown can **never make an alias unavailable**.
- An entry is marked when `convertResponse` decides to fail over, i.e. on a retryable pre-output status.

Consequences, all intentional: not shared across instances or restarts; not
consistent under a pooled runtime that reuses different module instances; no
distributed coordination; not a circuit breaker. New API's channel-level
`auto_ban` remains the only gateway health mechanism. A real cooldown would
require host-side support (persistent plugin state), which is outside this
repository.

### 3. Fallback trace and events — partial by design

Two channels are available:

- **Per-request trace in `state.fallbackTrace`**: one entry per hop with `alias`, `from`, `status`, `to` and (when a clock exists) `at`. Bounded to 8 entries.
- **Terminal failure**: when `fallbackTraceEnabled` is true and the chain does not recover, the returned reply carries `vmr_fallback: { alias, attempted, events }`. It is attached to whichever shape the plugin returns — `{ body }` for a JSON upstream reply, `{ error }` for a synthesized one. Successful replies are **never** modified.
- **Optional webhook**: with `fallbackWebhookUrl` set and host `utils.fetch` available, each fallback event is POSTed as `{ plugin, event: "fallback", alias, from, status, to, at? }`. Invalid URLs are ignored and every failure is swallowed, so routing is never affected.

> **Webhook latency caveat**: `utils.fetch` is synchronous. A slow or unreachable endpoint can add up to the host's per-call timeout to *every* failover hop. Keep it off unless the endpoint is fast, local and trusted; a failure here is swallowed but the added latency is not.

**Remaining hard limit**: a successful failover returns a 2xx upstream response
through `nativeResponse: true`; `convertResponse` is not called again, so the
plugin cannot decorate that response and cannot record the success in New API's
own consume logs. Gateway logs still show `attempt=1 / success` and
`returned_model` = the second target. To observe successful failovers, use the
optional webhook or upstream-side request logs. A truly first-class audit
record needs host support (a plugin log API or a metadata field the gateway
persists).

## Verification status

- `npm test`: 36/36 pass (22 pre-existing + 14 new). `npm run check` passes.
- Unit tests cover custom statuses, invalid-config degradation, cooldown hit and expiry, "all cooling" safety, trace on JSON and non-JSON terminal failures, successful-response immutability, webhook emission/degradation, and direct-passthrough isolation.
- **Not yet done**: live rc.51 integration with these options enabled. The v0.3.1 features are validated at the hook level only; form rendering of the array field, `utils.unixNow()` availability, and `utils.fetch` host allowance must be confirmed against the exact New API build before production use.

## Configuration example

```json
{
  "groups": { "auto-code": { "models": [ { "name": "model-a", "priority": 10, "weight": 70 }, { "name": "model-b", "priority": 10, "weight": 30 } ] } },
  "maxRetries": 1,
  "maxReplayBytes": 32768,
  "fallbackStatuses": [429, 502, 503, 504, 529],
  "cooldownSeconds": 30,
  "fallbackTraceEnabled": true,
  "fallbackWebhookUrl": ""
}
```

`fallbackStatuses` and `cooldownSeconds` are independent: a status outside the
list never marks a cooldown; a status inside the list marks one only when
`cooldownSeconds > 0`.
