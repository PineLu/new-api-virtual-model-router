# Virtual model configuration modes (no New API fork)

Version: plugin 0.2.1.

The Provider Plugin uses the built-in New API `channelConfig` schema rendering. There is **no custom UI bundle** and no New API core change.

## Visual table

Select **Visual table** under Plugin settings. Fill the `Virtual model routes` rows:

| Virtual model (alias) | Upstream model (name) | Priority | Weight |
| --- | --- | ---: | ---: |
| auto-code | model-a | 10 | 70 |
| auto-code | model-b | 10 | 30 |
| auto-code | model-c | 5 | 100 |

Each row describes one candidate. Priority is evaluated first; only equal-priority candidates participate in weighted selection. Use weight `0` to disable a candidate. The public alias must be included in the channel's **Models** list (P0 manifest currently advertises only `auto-code`).

Configuration format: [examples/table-config.json](../examples/table-config.json).

## JSON mode (backward compatible)

Select **JSON (existing configuration)** to edit the preexisting `groups` object. Previously saved channels without `editorMode` continue to use `groups`. JSON-only properties, such as `enabled: false`, remain supported.

Configuration format: [examples/channel-config.json](../examples/channel-config.json).

## Limits

- Table mode and JSON mode **retain separate values**. Switching modes does **not** copy one configuration into the other. Only the selected mode drives routing.
- The two modes appear inside **Plugin settings**. The official `Routing & Mapping` tab cannot be extended or moved by Provider Plugin metadata in New API rc.51.
- A model not present in any virtual group passes through to this channel's upstream unchanged, provided New API selected this channel for the requested model. If a matching virtual group exists but is invalid, the plugin rejects it rather than bypassing routing.
- This does not allow one plugin channel to forward traffic to another New API channel. Routing is confined to one Base URL and API key.
- The gateway controls pricing independently; the plugin does not calculate actual per-target billing.
- The table renders using the gateway's existing flat-array editor. Actual UI rendering must be verified against the installed New API build before release.
