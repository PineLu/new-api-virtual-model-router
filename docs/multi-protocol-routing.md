# Multi-protocol routing design (v0.3.0)

## Goal

Keep Virtual Model Router responsible only for model routing. Reuse New API RelayKit for protocol adaptation and do not implement a second protocol codec layer in this plugin.

## Supported client routes

| Client path | RelayKit converter | Plugin input format | Upstream path |
| --- | --- | --- | --- |
| /v1/chat/completions | plugin | OpenAI Chat | /v1/chat/completions |
| /v1/messages | anthropic_messages_to_openai_chat_completions+plugin | OpenAI Chat | /v1/chat/completions |
| /v1/responses | openai_responses_to_openai_chat_completions+plugin | OpenAI Chat | /v1/chat/completions |

## Request flow

1. New API selects the provider-plugin channel using its normal model, group, priority, weight and channel-affinity rules.
2. RelayKit converts Anthropic Messages or OpenAI Responses into OpenAI Chat Completions when required.
3. The plugin receives the canonical Chat request in convertRequest.
4. The plugin applies the existing alias lookup, priority/weight selection, retry limits and direct-model passthrough.
5. The plugin sends the request to the selected upstream model through /v1/chat/completions.

## Response flow

- The plugin sets nativeResponse: true. New API hands a successful upstream response to the route handler in its upstream protocol (OpenAI Chat), without running the plugin's convertResponse or convertStreamEvent hooks.
- RelayKit converts the successful JSON or SSE response back to the original client protocol.
- Non-2xx responses still pass through convertResponse; the existing bounded fallback policy remains owned by the plugin.
- The plugin does not parse or synthesize Anthropic/Responses events.

## Ownership boundaries

| Concern | Owner |
| --- | --- |
| Client protocol parsing and conversion | New API RelayKit |
| Upstream protocol conversion | New API RelayKit |
| Virtual aliases and model mapping | Virtual Model Router |
| Priority and weighted selection | Virtual Model Router |
| Bounded retry/fallback | Virtual Model Router |
| Real-model passthrough within selected channel | Virtual Model Router |
| Channel selection, API token authorization, user groups and billing | New API |

## Compatibility constraints

- Requires Provider Plugin API support for chained converters (<converter>+plugin); v0.3.0 targets New API v1.0.0-rc.51.
- Conversion is not guaranteed to preserve every protocol-specific feature. Validate Claude thinking blocks, tool use, Responses reasoning, multi-turn context, usage reporting and stream termination against the exact host build.
- Responses WebSocket is not included. The route uses the HTTP /v1/responses path.
- Gemini, embeddings, audio and image endpoints are not included in v0.3.0.
- No cross-channel or cross-provider routing is added.

## Test plan

### Automated unit tests

- Manifest exposes exactly the Chat, Messages and Responses routes and uses the documented RelayKit converter IDs.
- All routes converge on the same canonical Chat request shape and routing core.
- Virtual alias selection and direct real-model passthrough remain identical across the three route declarations.
- Existing priority, weighted selection, retry limits, table/JSON config and legacy behavior remain unchanged.

### Live New API integration tests (required before production use)

Run against the installed New API v1.0.0-rc.51 build and an isolated mock OpenAI-compatible upstream:

1. Chat JSON and SSE, including tools.
2. Anthropic Messages JSON and SSE; verify message_start, text deltas, tool-use blocks, message_delta and message_stop.
3. Responses synchronous JSON and streaming SSE; verify response.created, output item events, completion event and usage.
4. Verify all three client routes select the same virtual alias and route to the same weighted target pool.
5. Verify 429/502/503/504 fallback before output for all supported routes.
6. Verify direct real-model passthrough works on all three routes and never enters virtual fallback.
7. Verify unsupported protocol-specific options fail clearly or are handled by RelayKit without corrupting the response.
8. Compare usage and gateway billing records; do not assume exact per-target pricing.

The automated tests validate the plugin's manifest and routing core only. They do not claim to validate RelayKit's protocol conversion end to end.
