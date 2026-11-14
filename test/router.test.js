import test from "node:test";
import assert from "node:assert/strict";
import { meta, normalizeGroup, chooseModel, convertRequest, convertResponse, resolveModelGroups, normalizeFallbackStatuses } from "../plugin.js";

const groups = {
  "auto-code": {
    models: [
      { name: "model-a", priority: 10, weight: 70 },
      { name: "model-b", priority: 10, weight: 30 },
      { name: "model-c", priority: 5, weight: 100 }
    ]
  }
};
const ctx = (config = {}) => ({
  config: { groups, maxRetries: 1, maxReplayBytes: 32768, ...config }
});
const req = (stream = false) => ({
  model: "auto-code",
  stream,
  body: {
    model: "auto-code", stream,
    messages: [{ role: "user", content: "hello" }],
    tools: [{
      type: "function",
      function: { name: "ping", parameters: { type: "object", properties: {} } }
    }]
  }
});

test("manifest exposes Chat, Anthropic Messages and Responses routes through Chat", () => {
  assert.equal(meta.apiVersion, 1);
  assert.equal(meta.version, "0.3.2");
  assert.deepEqual(meta.models, ["auto-code"]); // rc.51 channel picker expects a non-empty models array
  assert.deepEqual(meta.relay, [
    {
      incoming_path: "/v1/chat/completions",
      upstream_path: "/v1/chat/completions",
      converter: "plugin"
    },
    {
      incoming_path: "/v1/messages",
      upstream_path: "/v1/chat/completions",
      converter: "anthropic_messages_to_openai_chat_completions+plugin"
    },
    {
      incoming_path: "/v1/responses",
      upstream_path: "/v1/chat/completions",
      converter: "openai_responses_to_openai_chat_completions+plugin"
    }
  ]);
  assert.equal(meta.channelConfig.properties.editorMode.default, "json");
  const rows = meta.channelConfig.properties.routes;
  assert.equal(rows.type, "array");
  assert.deepEqual(Object.keys(rows.items.properties), ["alias", "name", "priority", "weight"]);
  assert.deepEqual(rows.visibleWhen.editorMode, ["table"]);
  assert.deepEqual(meta.channelConfig.properties.groups.visibleWhen.editorMode, ["json"]);
  const cfg = meta.channelConfig.properties;
  assert.deepEqual(cfg.fallbackStatuses.default, [429, 502, 503, 504]);
  assert.equal(cfg.fallbackStatuses.items.type, "integer");
  assert.equal(cfg.fallbackStatuses.items.minimum, 400);
  assert.equal(cfg.fallbackStatuses.items.maximum, 599);
  assert.ok(cfg.fallbackStatuses.items.title, "ConfigField.items requires a title");
  assert.equal(cfg.fallbackStatuses.uniqueItems, true);
  assert.equal(cfg.cooldownSeconds.default, 0);
  assert.equal(cfg.fallbackTraceEnabled.default, false);
  assert.equal(cfg.fallbackWebhookUrl.default, "");
});
test("all client protocols share the same canonical Chat routing core", () => {
  const singleTarget = { "auto-code": { models: [{ name: "model-only" }] } };
  for (const path of ["/v1/chat/completions", "/v1/messages", "/v1/responses"]) {
    const request = req(true);
    const result = convertRequest({ ...ctx({ groups: singleTarget }), path }, request);
    assert.equal(result.path, "/v1/chat/completions", path);
    assert.equal(result.body.model, "model-only", path);
    assert.equal(result.body.messages[0].content, "hello", path);
    assert.equal(result.stream, true, path);
    assert.equal(result.nativeResponse, true, path);
    assert.equal(result.state.alias, "auto-code", path);
  }
});

test("direct real-model passthrough is shared across all client routes", () => {
  for (const path of ["/v1/chat/completions", "/v1/messages", "/v1/responses"]) {
    const request = req(false);
    request.model = "openrouter/free";
    request.body.model = "openrouter/free";
    const result = convertRequest({ ...ctx(), path }, request);
    assert.equal(result.path, "/v1/chat/completions", path);
    assert.equal(result.body.model, "openrouter/free", path);
    assert.equal(result.state.direct, true, path);
    assert.equal(result.state.maxRetries, 0, path);
  }
});

test("validates alias, duplicates, cycles and positive traffic", () => {
  assert.equal(normalizeGroup(groups, "auto-code").length, 3);
  assert.throws(() => normalizeGroup(groups, "missing"), /not configured/);
  assert.throws(() => normalizeGroup({ x: { models: [{ name: "a" }, { name: "a" }] } }, "x"), /duplicate/);
  assert.throws(() => normalizeGroup({ x: { models: [{ name: "x" }] } }, "x"), /must differ/);
  assert.throws(() => normalizeGroup({ x: { models: [{ name: "a", weight: 0 }] } }, "x"), /positive weight/);
});
test("priority dominates weight, then weighted 70:30 sampling", () => {
  const m = normalizeGroup(groups, "auto-code");
  assert.equal(chooseModel(m, [], 0.1).name, "model-a");
  assert.equal(chooseModel(m, [], 0.699).name, "model-a");
  assert.equal(chooseModel(m, [], 0.7).name, "model-b");
  assert.equal(chooseModel(m, [], 0.99).name, "model-b");
  assert.equal(chooseModel(m, ["model-a", "model-b"]).name, "model-c");
  assert.equal(chooseModel(m, ["model-a", "model-b", "model-c"]), null);
});
test("disabled and zero-weight candidates are excluded", () => {
  const m = normalizeGroup({ x: { models: [
    { name: "a", priority: 100, weight: 0 },
    { name: "b", priority: 50, enabled: false },
    { name: "c", priority: 1, weight: 1 }
  ] } }, "x");
  assert.equal(chooseModel(m).name, "c");
});
test("rewrites only the upstream model and preserves tools", () => {
  const request = req(true);
  const result = convertRequest(ctx({ maxRetries: 0 }), request);
  assert.ok(["model-a", "model-b"].includes(result.body.model));
  assert.equal(result.body.tools[0].function.name, "ping");
  assert.equal(result.stream, true);
  assert.equal(result.nativeResponse, true);
  assert.equal(request.body.model, "auto-code");
  assert.equal(result.state.replayBody, null);
});
test("pre-output HTTP 429 falls back once, but not twice", () => {
  const first = convertRequest(ctx(), req(true));
  const second = convertResponse({ state: first.state }, {
    status: 429, body: '{"error":{"message":"limited"}}'
  });
  assert.ok(second.next);
  assert.notEqual(second.next.body.model, first.body.model);
  assert.equal(second.next.nativeResponse, true);
  const last = convertResponse({ state: second.state }, {
    status: 503, body: '{"error":{"message":"down"}}'
  });
  assert.equal(last.next, undefined);
  assert.equal(last.body.error.message, "down");
});
test("does not switch on HTTP 400 or 401", () => {
  const first = convertRequest(ctx(), req());
  for (const status of [400, 401]) {
    const out = convertResponse({ state: first.state }, {
      status, body: '{"error":{"message":"invalid"}}'
    });
    assert.equal(out.next, undefined);
    assert.equal(out.body.error.message, "invalid");
  }
});
test("large requests are never replayed", () => {
  const request = req();
  request.body.messages[0].content = "x".repeat(50000);
  const first = convertRequest(ctx(), request);
  assert.equal(first.state.replayBody, null);
  const out = convertResponse({ state: first.state }, {
    status: 503, body: '{"error":{"message":"failed"}}'
  });
  assert.equal(out.next, undefined);
});
test("rejects model_mapping hiding the alias", () => {
  const request = req();
  request.model = "mapped-upstream";
  assert.throws(() => convertRequest(ctx(), request), /model_mapping/);
});

const tableRows = [
  { alias: "auto-code", name: "model-a", priority: 10, weight: 70 },
  { alias: "auto-code", name: "model-b", priority: 10, weight: 30 },
  { alias: "auto-code", name: "model-c", priority: 5, weight: 100 },
  { alias: "auto-chat", name: "model-d", priority: 1, weight: 1 }
];

test("visual table builds multiple groups without changing routing semantics", () => {
  const config = { editorMode: "table", routes: tableRows };
  const parsed = resolveModelGroups(config);
  assert.deepEqual(normalizeGroup(parsed, "auto-code"), normalizeGroup(groups, "auto-code"));
  assert.equal(normalizeGroup(parsed, "auto-chat")[0].name, "model-d");
  const request = convertRequest(ctx(config), req());
  assert.ok(["model-a", "model-b"].includes(request.body.model));
  assert.equal(request.state.models.length, 3);
});

test("existing groups JSON remains compatible when mode is omitted", () => {
  assert.equal(resolveModelGroups({ groups }), groups);
  assert.equal(resolveModelGroups({ editorMode: "json", groups, routes: tableRows }), groups);
});

test("switching to table mode uses only table rows, not stale JSON", () => {
  const result = convertRequest(ctx({
    editorMode: "table",
    routes: [{ alias: "auto-code", name: "table-only", priority: 1, weight: 1 }],
    groups
  }), req());
  assert.equal(result.body.model, "table-only");
});

test("table mode rejects missing or malformed routing data", () => {
  assert.deepEqual(Object.keys(resolveModelGroups({ editorMode: "table" })), []);
  assert.throws(() => resolveModelGroups({ editorMode: "table", routes: [{ name: "bad" }] }), /alias must be non-empty/);
  assert.throws(() => resolveModelGroups({ editorMode: "table", routes: {} }), /must be an array/);
  assert.throws(() => resolveModelGroups({ editorMode: "nope", groups }), /unknown virtual model editor mode/);
  const duplicate = { editorMode: "table", routes: [
    { alias: "auto-code", name: "a" }, { alias: "auto-code", name: "a" }
  ] };
  assert.throws(() => normalizeGroup(resolveModelGroups(duplicate), "auto-code"), /duplicate candidate/);
});

test("table disabled target has zero weight and fallback keeps priority order", () => {
  const selected = normalizeGroup(resolveModelGroups({
    editorMode: "table",
    routes: [
      { alias: "auto-code", name: "disabled", priority: 20, weight: 0 },
      { alias: "auto-code", name: "primary", priority: 10, weight: 1 },
      { alias: "auto-code", name: "fallback", priority: 5, weight: 1 }
    ]
  }), "auto-code");
  assert.equal(chooseModel(selected).name, "primary");
  assert.equal(chooseModel(selected, ["primary"]).name, "fallback");
});

test("unmapped real model bypasses virtual selection and retains request fields", () => {
  const request = req(false);
  request.model = "openrouter/free";
  request.body.model = "openrouter/free";
  const out = convertRequest(ctx({ editorMode: "table", routes: tableRows }), request);
  assert.equal(out.body.model, "openrouter/free");
  assert.deepEqual(out.body.messages, request.body.messages);
  assert.deepEqual(out.body.tools, request.body.tools);
  assert.equal(out.nativeResponse, true);
  assert.equal(out.state.direct, true);
  assert.equal(out.state.maxRetries, 0);
  assert.equal(request.body.model, "openrouter/free");
});

test("direct passthrough also works with JSON, empty table and no groups", () => {
  const request = req(true);
  request.model = "nvidia/nemotron-3.5-super-vl:free";
  request.body.model = request.model;
  for (const config of [
    { groups },
    { editorMode: "table", routes: [] },
    { editorMode: "table" },
    {}
  ]) {
    const result = convertRequest(ctx(config), request);
    assert.equal(result.body.model, request.model);
    assert.equal(result.stream, true);
    assert.equal(result.state.direct, true);
  }
});

test("virtual group takes precedence over direct passthrough", () => {
  const result = convertRequest(ctx({ editorMode: "table", routes: tableRows }), req());
  assert.ok(["model-a", "model-b"].includes(result.body.model));
  assert.equal(result.state.direct, undefined);
});

test("malformed configured virtual group fails closed, not direct", () => {
  assert.throws(
    () => convertRequest(ctx({
      editorMode: "table",
      routes: [{ alias: "auto-code", name: "broken", weight: 0 }]
    }), req()),
    /positive weight/
  );
});

test("direct upstream errors do not switch into virtual fallback targets", () => {
  const request = req(false);
  request.model = "openrouter/free";
  request.body.model = request.model;
  const first = convertRequest(ctx(), request);
  const result = convertResponse({ state: first.state }, {
    status: 429,
    body: '{"error":{"message":"no quota"}}'
  });
  assert.equal(result.next, undefined);
  assert.equal(result.body.error.message, "no quota");
});

test("request-model mismatch remains denied for direct calls", () => {
  const request = req();
  request.model = "openrouter/free";
  request.body.model = "nvidia/nemotron-3.5-super-vl:free";
  assert.throws(() => convertRequest(ctx(), request), /model_mapping/);
});

// ---- 0.3.1: configurable statuses, best-effort cooldown, fallback trace ----

// Distinct priorities make target selection deterministic regardless of Math.random.
const prioGroups = (alias) => ({ [alias]: { models: [
  { name: "prio-high", priority: 10, weight: 1 },
  { name: "prio-low", priority: 5, weight: 1 }
] } });
const prioReq = (alias) => ({
  model: alias, stream: false,
  body: { model: alias, stream: false, messages: [{ role: "user", content: "hi" }] }
});
const prioCtx = (alias, config = {}) => ({ config: { groups: prioGroups(alias), maxRetries: 1, maxReplayBytes: 32768, ...config } });

// Inject a controllable host clock; clean up so it never leaks between tests.
function withClock(t, fn) {
  const saved = globalThis.utils;
  globalThis.utils = { unixNow: () => t };
  try { return fn(); } finally {
    if (saved === undefined) delete globalThis.utils; else globalThis.utils = saved;
  }
}

test("normalizeFallbackStatuses validates and defaults", () => {
  assert.deepEqual(normalizeFallbackStatuses(undefined), [429, 502, 503, 504]);
  assert.deepEqual(normalizeFallbackStatuses([]), [429, 502, 503, 504]);
  assert.deepEqual(normalizeFallbackStatuses("bad"), [429, 502, 503, 504]);
  assert.deepEqual(normalizeFallbackStatuses([399, 600, "429", null]), [429, 502, 503, 504]);
  assert.deepEqual(normalizeFallbackStatuses([418, 429, 418, 503]), [418, 429, 503]);
  assert.deepEqual(normalizeFallbackStatuses([500]), [500]);
});

test("configurable retryable statuses are honoured; defaults change accordingly", () => {
  const a = "cfg-status-custom";
  const first = convertRequest(prioCtx(a, { fallbackStatuses: [418] }), prioReq(a));
  assert.equal(first.body.model, "prio-high");
  const hit = convertResponse({ state: first.state }, { status: 418, body: '{"error":{"message":"teapot"}}' });
  assert.ok(hit.next, "418 must trigger fallback when configured");
  assert.equal(hit.next.body.model, "prio-low");
  const miss = convertResponse({ state: first.state }, { status: 429, body: '{"error":{"message":"limited"}}' });
  assert.equal(miss.next, undefined, "429 must NOT trigger fallback once overridden");
  assert.equal(miss.body.error.message, "limited");
});

test("default behaviour is unchanged when new options are absent", () => {
  const a = "cfg-status-default";
  const first = convertRequest(prioCtx(a), prioReq(a));
  assert.deepEqual(first.state.fallbackStatuses, [429, 502, 503, 504]);
  assert.equal(first.state.cooldownSeconds, 0);
  assert.equal(first.state.fallbackTraceEnabled, false);
  assert.equal(first.state.fallbackWebhookUrl, "");
  assert.deepEqual(first.state.fallbackTrace, []);
  for (const s of [429, 502, 503, 504]) {
    assert.ok(convertResponse({ state: first.state }, { status: s, body: '{"error":{"message":"x"}}' }).next);
  }
  for (const s of [400, 401, 404, 500]) {
    assert.equal(convertResponse({ state: first.state }, { status: s, body: '{"error":{"message":"x"}}' }).next, undefined);
  }
});

test("invalid cooldownSeconds / status config degrades safely", () => {
  const a = "cfg-invalid";
  const first = convertRequest(prioCtx(a, { cooldownSeconds: 9999, fallbackStatuses: [1, 2, 3] }), prioReq(a));
  assert.equal(first.state.cooldownSeconds, 0);
  assert.deepEqual(first.state.fallbackStatuses, [429, 502, 503, 504]);
  assert.equal(first.body.model, "prio-high");
});

test("best-effort cooldown skips a recently failed target, then recovers", () => {
  const a = "cfg-cooldown-recover";
  const config = { cooldownSeconds: 30 };
  // T=1000: first request picks prio-high; a 429 marks it cooling and falls back.
  const first = withClock(1000, () => convertRequest(prioCtx(a, config), prioReq(a)));
  assert.equal(first.body.model, "prio-high");
  const fall = withClock(1000, () => convertResponse({ state: first.state }, {
    status: 429, body: '{"error":{"message":"limited"}}'
  }));
  assert.equal(fall.next.body.model, "prio-low");
  // T=1005: a NEW request must avoid prio-high while cooling.
  const second = withClock(1005, () => convertRequest(prioCtx(a, config), prioReq(a)));
  assert.equal(second.body.model, "prio-low");
  // T=1040: cooldown expired, prio-high is eligible again.
  const third = withClock(1040, () => convertRequest(prioCtx(a, config), prioReq(a)));
  assert.equal(third.body.model, "prio-high");
});

test("cooldown is disabled by default and cannot make an alias unavailable", () => {
  const a = "cfg-cooldown-all";
  const config = { cooldownSeconds: 60 };
  // Mark both targets cooling via two chains, then ensure a request still resolves.
  withClock(2000, () => {
    const f1 = convertRequest(prioCtx(a, config), prioReq(a));
    const r1 = convertResponse({ state: f1.state }, { status: 503, body: '{"error":{"message":"down"}}' });
    const r2 = convertResponse({ state: r1.state }, { status: 503, body: '{"error":{"message":"down"}}' });
    assert.equal(r2.next, undefined, "maxRetries caps the chain");
  });
  const next = withClock(2001, () => convertRequest(prioCtx(a, config), prioReq(a)));
  assert.ok(next.body.model === "prio-high" || next.body.model === "prio-low",
    "with all targets cooling, the router still returns a candidate");
  // Without cooldown configured, no clock is consulted at all.
  const plain = convertRequest(prioCtx("cfg-cooldown-off"), prioReq("cfg-cooldown-off"));
  assert.equal(plain.state.cooldownSeconds, 0);
});

test("fallback trace accumulates in state and is exposed on terminal failure", () => {
  const a = "cfg-trace";
  const config = { fallbackTraceEnabled: true };
  const first = convertRequest(prioCtx(a, config), prioReq(a));
  const second = convertResponse({ state: first.state }, { status: 429, body: '{"error":{"message":"limited"}}' });
  assert.equal(second.state.fallbackTrace.length, 1);
  assert.equal(second.state.fallbackTrace[0].from, "prio-high");
  assert.equal(second.state.fallbackTrace[0].to, "prio-low");
  assert.equal(second.state.fallbackTrace[0].status, 429);
  const last = convertResponse({ state: second.state }, { status: 503, body: '{"error":{"message":"down"}}' });
  assert.equal(last.next, undefined);
  // The gateway rebuilds non-2xx bodies from a fixed schema, so the trace rides
  // at the end of the message string instead of a sibling JSON field.
  assert.ok(last.body.error.message.startsWith("down | vmr_fallback="));
  const payload = JSON.parse(last.body.error.message.slice(last.body.error.message.indexOf("vmr_fallback=") + "vmr_fallback=".length));
  assert.equal(payload.alias, a);
  assert.deepEqual(payload.attempted, ["prio-high", "prio-low"]);
  assert.equal(payload.events.length, 1);
});

test("trace also attaches when the upstream reply is non-JSON", () => {
  const a = "cfg-trace-nonjson";
  const first = convertRequest(prioCtx(a, { fallbackTraceEnabled: true }), prioReq(a));
  const fall = convertResponse({ state: first.state }, { status: 429, body: "rate limited" });
  assert.ok(fall.next);
  const last = convertResponse({ state: fall.state }, { status: 503, body: "<html>down</html>" });
  assert.equal(last.next, undefined);
  assert.equal(last.error.status, 503);
  const payload = JSON.parse(last.error.message.slice(last.error.message.indexOf("vmr_fallback=") + "vmr_fallback=".length));
  assert.deepEqual(payload.attempted, ["prio-high", "prio-low"]);
  assert.equal(payload.events.length, 1);
});

test("successful fallback keeps the native upstream body unmodified", () => {
  const a = "cfg-trace-success";
  const first = convertRequest(prioCtx(a, { fallbackTraceEnabled: true }), prioReq(a));
  const fall = convertResponse({ state: first.state }, { status: 429, body: '{"error":{"message":"limited"}}' });
  assert.ok(fall.next);
  // A successful upstream reply after failover is handed back verbatim.
  const ok = convertResponse({ state: fall.state }, { status: 200, body: '{"choices":[{"message":{"content":"ok"}}]}' });
  assert.deepEqual(ok.body, { choices: [{ message: { content: "ok" } }] });
  assert.equal(ok.body.vmr_fallback, undefined);
});

test("trace is off by default, so error responses are byte-compatible", () => {
  const a = "cfg-trace-default";
  const first = convertRequest(prioCtx(a), prioReq(a));
  const last = convertResponse({ state: first.state }, { status: 500, body: '{"error":{"message":"boom"}}' });
  assert.equal(last.body.error.vmr_fallback, undefined);
  assert.deepEqual(last.body.error, { message: "boom" });
});

test("optional webhook emits a best-effort event and never throws", () => {
  const a = "cfg-webhook";
  const calls = [];
  const saved = globalThis.utils;
  globalThis.utils = {
    unixNow: () => 3000,
    fetch: (r) => { calls.push(r); return { status: 200, headers: {}, body: {} }; }
  };
  try {
    const first = convertRequest(prioCtx(a, { fallbackWebhookUrl: "https://example.com/hook" }), prioReq(a));
    const fall = convertResponse({ state: first.state }, { status: 429, body: '{"error":{"message":"limited"}}' });
    assert.ok(fall.next);
    assert.equal(calls.length, 1);
    // Provider hooks cannot POST; the event must be a GET with query params.
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].body, undefined);
    const u = new URL(calls[0].url);
    assert.equal(u.origin + u.pathname, "https://example.com/hook");
    assert.equal(u.searchParams.get("plugin"), "virtual-model-router");
    assert.equal(u.searchParams.get("event"), "fallback");
    assert.equal(u.searchParams.get("status"), "429");
    assert.equal(u.searchParams.get("alias"), a);
    // The hook outcome is observable on the accumulated trace.
    assert.equal(fall.state.fallbackTrace[0].webhook.ok, true);
    assert.equal(fall.state.fallbackTrace[0].webhook.status, 200);
  } finally {
    if (saved === undefined) delete globalThis.utils; else globalThis.utils = saved;
  }
});

test("webhook without a host fetch capability degrades silently", () => {
  const a = "cfg-webhook-no-fetch";
  const saved = globalThis.utils;
  delete globalThis.utils;
  try {
    const first = convertRequest(prioCtx(a, { fallbackWebhookUrl: "https://example.com/hook" }), prioReq(a));
    const fall = convertResponse({ state: first.state }, { status: 429, body: '{"error":{"message":"limited"}}' });
    assert.ok(fall.next, "fallback still works without webhook support");
  } finally {
    if (saved === undefined) delete globalThis.utils; else globalThis.utils = saved;
  }
});

test("invalid webhook URL is ignored", () => {
  const a = "cfg-webhook-badurl";
  const calls = [];
  const saved = globalThis.utils;
  globalThis.utils = { unixNow: () => 4000, fetch: (r) => { calls.push(r); return { status: 200, headers: {}, body: {} }; } };
  try {
    const first = convertRequest(prioCtx(a, { fallbackWebhookUrl: "file:///etc/passwd" }), prioReq(a));
    convertResponse({ state: first.state }, { status: 429, body: '{"error":{"message":"limited"}}' });
    assert.equal(calls.length, 0);
  } finally {
    if (saved === undefined) delete globalThis.utils; else globalThis.utils = saved;
  }
});

test("direct passthrough is unaffected by the new fallback options", () => {
  const a = "cfg-direct";
  const request = prioReq("real/model");
  request.model = "real/model";
  const first = convertRequest(prioCtx(a, { fallbackTraceEnabled: true, cooldownSeconds: 30 }), request);
  assert.equal(first.state.direct, true);
  assert.equal(first.state.maxRetries, 0);
  const out = convertResponse({ state: first.state }, { status: 429, body: '{"error":{"message":"no quota"}}' });
  assert.equal(out.next, undefined);
  assert.equal(out.body.error.message, "no quota");
  assert.equal(out.body.error.vmr_fallback, undefined);
});
