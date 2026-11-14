# P0 Live Validation — 2026-11-14

## Environment

- Host: New API `v1.0.0-rc.51` running in Podman.
- Plugin: `virtual-model-router` `v0.1.2`, installed and activated through the New API admin UI.
- Test channel: isolated type-61 Provider Plugin channel (test ID 13); upstream was a temporary local OpenAI-compatible mock server.
- Public alias: `auto-code`; actual targets: `mock-a`, `mock-b`, and lower-priority `mock-fail`.
- Test token: short-lived, limited to `auto-code` and a USD 0.10 quota. No real-provider credentials were used.

## Results

| Check | Outcome |
| --- | --- |
| Upload + activation | PASS |
| Channel creation | PASS after `meta.models` compatibility fix |
| Unit tests | PASS, 9/9 |
| Direct Chat Completions request | PASS, HTTP 200, `auto-code` resolved to `mock-a` |
| 30-request weighted selection (70/30 config) | PASS, `mock-a`: 22, `mock-b`: 8, failures: 0 |
| SSE streaming | PASS, HTTP 200, final `[DONE]` |
| Tool-call response | PASS, `finish_reason=tool_calls`, function `ping` preserved |
| HTTP 429 fallback, non-stream | PASS, 10/10 returned `mock-b` |
| HTTP 429 fallback, stream | PASS, 5/5 returned `mock-b` with complete stream |
| Test token requesting a non-whitelisted model | PASS, HTTP 403 |
| Gateway logs | PASS, request model `auto-code` and response model `mock-b` both visible |

## Issues discovered

1. **New API rc.51 channel picker:** `plugin.models.length` crashed when a provider plugin advertised no models. Adding an empty list did not fix it because the host/UI still encountered null. Plugin v0.1.2 advertises `meta.models: ["auto-code"]` to make the channel form functional.
2. **Pricing:** The virtual model `auto-code` has no configured price in this environment, so consumption logs show **$0**. Per-target differential billing has NOT been validated and is NOT supported by the P0 implementation.
3. **Scope:** P0 tests one advertised alias with multiple upstream models on one provider channel. Real provider credentials, cross-provider routing, exact billing, and network-error/partial-stream recovery remain untested.

## Notes

- Test results come from actual `/v1/chat/completions` calls through New API, not only direct mock requests.
- The temporary mock intentionally returns 429 for `mock-a` when the message contains the test marker `vmr-fallback`; this tests pre-output fallback to `mock-b`.
- This is a **P0 integration proof**, not a production readiness certification.
