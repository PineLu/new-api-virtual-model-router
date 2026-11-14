import test from "node:test";
import assert from "node:assert/strict";
import { meta, normalizeGroup, chooseModel, convertRequest, convertResponse } from "../plugin.js";

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

test("manifest exposes the Chat Completions provider route", () => {
  assert.equal(meta.apiVersion, 1);
  assert.deepEqual(meta.models, ["auto-code"]); // rc.51 channel picker expects a non-empty models array
  assert.equal(meta.relay.length, 1);
  assert.equal(meta.relay[0].converter, "plugin");
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
