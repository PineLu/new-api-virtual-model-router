/**
 * New API Virtual Model Router — Provider Plugin API v1.
 * Routes aliases within ONE upstream channel, Base URL and credential.
 */
export const meta = {
  apiVersion: 1,
  key: "virtual-model-router",
  name: { en: "Virtual Model Router", zh: "虚拟模型路由" },
  version: "0.1.1",
  author: { name: "PineLu" },
  description: {
    en: "Route one virtual model alias to multiple upstream models on the same provider.",
    zh: "将自定义模型别名按优先级和权重路由到同一提供商的多个真实模型。"
  },
  models: [], // Frontend channel picker expects an array, not null; aliases live in channel models.
  icon: "text:VR",
  relay: [{
    incoming_path: "/v1/chat/completions",
    upstream_path: "/v1/chat/completions",
    converter: "plugin"
  }],
  channelConfig: {
    type: "object",
    properties: {
      groups: {
        type: "object",
        format: "json",
        title: { en: "Virtual model groups (JSON)", zh: "虚拟模型组（JSON）" },
        description: {
          en: "Object keyed by public aliases; each group has a models array.",
          zh: "以对外模型别名为键，每个模型组包含 models 数组。"
        }
      },
      maxRetries: {
        type: "integer",
        title: { en: "Fallback attempts", zh: "故障切换次数" },
        minimum: 0, maximum: 2, default: 1
      },
      maxReplayBytes: {
        type: "integer",
        title: { en: "Maximum replay body bytes", zh: "允许重放的最大请求字节数" },
        minimum: 0, maximum: 65536, default: 32768
      }
    },
    required: ["groups"]
  }
};

const ENDPOINT = "/v1/chat/completions";
const FALLBACK_STATUSES = [429, 502, 503, 504];
const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const hasOwn = (v, key) => Object.prototype.hasOwnProperty.call(v, key);
const integerInRange = (v, min, max, fallback) =>
  Number.isInteger(v) && v >= min && v <= max ? v : fallback;

export function normalizeGroup(groups, alias) {
  if (!isRecord(groups) || typeof alias !== "string" || !hasOwn(groups, alias))
    throw new Error("virtual model alias is not configured: " + String(alias));
  const group = groups[alias];
  if (!isRecord(group) || !Array.isArray(group.models) || !group.models.length)
    throw new Error("virtual model " + alias + ": non-empty models array required");
  const seen = new Set();
  const models = group.models.map((raw, i) => {
    if (!isRecord(raw) || typeof raw.name !== "string" || !raw.name.trim())
      throw new Error("virtual model " + alias + ": models[" + i + "].name must be non-empty");
    const name = raw.name.trim();
    if (seen.has(name)) throw new Error("virtual model " + alias + ": duplicate candidate " + name);
    if (name === alias) throw new Error("virtual model " + alias + ": candidate must differ from alias");
    seen.add(name);
    const priority = raw.priority === undefined ? 0 : raw.priority;
    const weight = raw.weight === undefined ? 1 : raw.weight;
    if (!Number.isInteger(priority) || priority < -10000 || priority > 10000)
      throw new Error("virtual model " + alias + ": invalid priority for " + name);
    if (!Number.isInteger(weight) || weight < 0 || weight > 100000)
      throw new Error("virtual model " + alias + ": invalid weight for " + name);
    return { name, enabled: raw.enabled !== false, priority, weight };
  });
  if (!models.some(m => m.enabled && m.weight > 0))
    throw new Error("virtual model " + alias + ": at least one enabled candidate with positive weight required");
  return models;
}

/** Priority precedes weight. Excludes disabled, zero-weight or attempted models. */
export function chooseModel(models, excluded = [], random = Math.random()) {
  const blocked = new Set(excluded);
  const eligible = models.filter(m => m.enabled && m.weight > 0 && !blocked.has(m.name));
  if (!eligible.length) return null;
  const highest = Math.max(...eligible.map(m => m.priority));
  const tier = eligible.filter(m => m.priority === highest);
  const total = tier.reduce((n, m) => n + m.weight, 0);
  const unit = Number.isFinite(random) ? Math.max(0, Math.min(random, 0.999999999999)) : 0;
  let cursor = unit * total;
  for (const model of tier) {
    cursor -= model.weight;
    if (cursor < 0) return model;
  }
  return tier[tier.length - 1];
}

// UTF-8 byte counting without TextEncoder (may be absent in the plugin sandbox).
function utf8Length(value, limit) {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length
      && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) {
      bytes += 4; i++;
    } else bytes += 3;
    if (bytes > limit) return bytes;
  }
  return bytes;
}
function parseJSON(body) {
  if (typeof body !== "string") return null;
  try { return JSON.parse(body); } catch { return null; }
}
function upstreamReply(response) {
  const parsed = parseJSON(response.body);
  if (parsed !== null) return { body: parsed };
  return { error: {
    status: response.status >= 400 ? response.status : 502,
    message: "Non-JSON or unsupported upstream response"
  }};
}

/** Rewrites only the upstream JSON model field; never mutates client input. */
export function convertRequest(ctx, request) {
  const alias = request.model;
  if (!isRecord(request.body))
    throw new Error("Virtual Model Router supports JSON Chat Completions bodies only");
  if (typeof alias !== "string" || request.body.model !== alias)
    throw new Error("Do not configure channel model_mapping for virtual aliases");
  const models = normalizeGroup(ctx.config?.groups, alias);
  const chosen = chooseModel(models);
  if (chosen === null) throw new Error("virtual model " + alias + ": no eligible candidates");
  const body = { ...request.body, model: chosen.name };
  const maxRetries = integerInRange(ctx.config?.maxRetries, 0, 2, 1);
  const maxReplayBytes = integerInRange(ctx.config?.maxReplayBytes, 0, 65536, 32768);
  const replayBody = maxRetries > 0 && utf8Length(JSON.stringify(body), maxReplayBytes) <= maxReplayBytes
    ? body : null;
  return {
    body, path: ENDPOINT, stream: request.stream === true, nativeResponse: true,
    state: {
      alias, models, attempted: [chosen.name], maxRetries,
      stream: request.stream === true, replayBody
    }
  };
}

/** Only fail over on retryable pre-output HTTP responses, never broken streams. */
export function convertResponse(ctx, response) {
  const state = ctx.state;
  if (FALLBACK_STATUSES.includes(response.status)
      && isRecord(state) && isRecord(state.replayBody)
      && Array.isArray(state.models) && Array.isArray(state.attempted)
      && state.attempted.length <= state.maxRetries) {
    const chosen = chooseModel(state.models, state.attempted);
    if (chosen !== null) return {
      next: {
        path: ENDPOINT, body: { ...state.replayBody, model: chosen.name },
        stream: state.stream, nativeResponse: true
      },
      state: { ...state, attempted: [...state.attempted, chosen.name] }
    };
  }
  return upstreamReply(response);
}

/** Hook required by converter='plugin'; 2xx SSE is normally nativeResponse. */
export function convertStreamEvent(_ctx, input) {
  if (input.done) return {};
  if (typeof input.data !== "string")
    return { error: { status: 502, message: "Unsupported upstream stream event" } };
  let data = input.data;
  try { data = JSON.parse(input.data); } catch {}
  return { events: [{ ...(input.event ? { event: input.event } : {}), data }] };
}
