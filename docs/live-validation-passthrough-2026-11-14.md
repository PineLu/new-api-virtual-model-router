# Real-model passthrough live validation — 2026-11-14

## Environment
- New API: v1.0.0-rc.51 (local `localhost:3003`).
- Plugin: `virtual-model-router` v0.2.1, uploaded as JavaScript source and explicitly activated in the plugin manager.
- Existing channel: `#14 OpenRouter_virtual_router`; retained its API URL/credentials, groups and 50:50 virtual routing table.

## Results
- **20/20 unit tests PASS**: virtual routing, table/JSON compatibility, direct passthrough, SSE flags and tools preservation, error behavior, and model mismatch rejection.
- **Real channel test PASS**: built-in New API channel test selected channel 14 with requested model `baidu/ernie-5.5-flash-preview:free` (not a virtual alias). Host logs confirm `IsModelMapped: false` and the same `UpstreamModelName`.
- New API logged HTTP 200 for the channel test, `request_completed`, 26 prompt tokens, 16 completion tokens, and upstream cost 0.
- This particular free reasoning model returned a valid completion response with `finish_reason=length` and null normal text content; this validates routing/transport, **not text-answer quality**.

## Safety and limitations
- Only models for which the New API gateway selected this channel can reach the plugin. The plugin does not independently fetch the channel model allowlist.
- If a requested name is a configured virtual alias, the virtual route takes precedence; invalid virtual groups fail rather than falling through.
- Direct passthrough calls do not fail over into unrelated virtual groups.
- The feature does not imply cross-channel routing, precise per-target billing, or Responses/Claude Messages compatibility.
- Live direct passthrough verified; virtual route itself is covered by unit regression and earlier P0 tests, not re-exercised via a fresh paid call in this validation.
