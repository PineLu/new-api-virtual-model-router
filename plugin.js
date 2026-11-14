/**
 * New API Virtual Model Router — Provider Plugin API v1.
 * Routes aliases within ONE upstream channel, Base URL and credential.
 */
export const meta = {
  apiVersion: 1,
  key: "virtual-model-router",
  name: { en: "Virtual Model Router", zh: "虚拟模型路由" },
  version: "0.3.5",
  author: { name: "PineLu" },
  description: {
    en: "Route virtual model groups and pass through real models across Chat, Responses and Anthropic Messages using New API protocol converters.",
    zh: "通过 New API 协议转换器，为 Chat、Responses 和 Anthropic Messages 提供统一的虚拟模型路由及真实模型直通。"
  },
  models: ["auto-code"], // rc.51 channel picker requires a non-empty model list; P0 advertises one alias.
  icon: "text:VR",
  relay: [
    // OpenAI Chat Completions is the router's canonical internal format.
    {
      incoming_path: "/v1/chat/completions",
      upstream_path: "/v1/chat/completions",
      converter: "plugin"
    },
    // New API RelayKit converts Anthropic Messages to Chat before routing,
    // then converts the upstream Chat response/stream back to Anthropic.
    {
      incoming_path: "/v1/messages",
      upstream_path: "/v1/chat/completions",
      converter: "anthropic_messages_to_openai_chat_completions+plugin"
    },
    // New API RelayKit converts Responses to Chat before routing and converts
    // the upstream Chat response/stream back to the original Responses format.
    {
      incoming_path: "/v1/responses",
      upstream_path: "/v1/chat/completions",
      converter: "openai_responses_to_openai_chat_completions+plugin"
    }
  ],
  channelConfig: {
    type: "object",
    properties: {
      editorMode: {
        type: "string",
        title: { en: "Configuration editor", zh: "配置方式" },
        description: {
          en: "Use the table for simple routing or JSON for advanced groups; switching does not auto-convert values.",
          zh: "简单路由选表格，高级配置选 JSON；切换不会自动转换两种格式的数据。"
        },
        enum: ["json", "table"],
        enumTitles: [
          { en: "JSON (existing configuration)", zh: "JSON（兼容旧配置）" },
          { en: "Visual table", zh: "可视化表格" }
        ],
        default: "json"
      },
      routes: {
        type: "array",
        title: { en: "Virtual model routes (table)", zh: "虚拟模型路由表" },
        description: {
          en: "One row per upstream model. Equal priority uses weights; weight 0 disables a target. Only used in table mode.",
          zh: "每个上游模型一行。同优先级按权重分流；权重为 0 表示禁用。仅表格模式生效。"
        },
        visibleWhen: { editorMode: ["table"] },
        items: {
          type: "object",
          title: { en: "Model route", zh: "模型路由" },
          properties: {
            alias: {
              type: "string",
              title: { en: "Virtual model", zh: "虚拟模型" }
            },
            name: {
              type: "string",
              title: { en: "Upstream model", zh: "上游模型" }
            },
            priority: {
              type: "integer",
              title: { en: "Priority", zh: "优先级" },
              default: 0,
              minimum: -10000,
              maximum: 10000
            },
            weight: {
              type: "integer",
              title: { en: "Weight", zh: "权重" },
              default: 1,
              minimum: 0,
              maximum: 100000
            }
          },
          required: ["alias", "name"]
        }
      },
      groups: {
        type: "object",
        format: "json",
        title: { en: "Virtual model groups (JSON)", zh: "虚拟模型组（JSON）" },
        description: {
          en: "Object keyed by public aliases; each group has a models array.",
          zh: "以对外模型别名为键，每个模型组包含 models 数组；仅 JSON 模式生效。"
        },
        visibleWhen: { editorMode: ["json"] }
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
      },
      fallbackStatuses: {
        type: "array",
        title: { en: "Retryable upstream statuses", zh: "可回退的上游状态码" },
        description: {
          en: "Pre-output upstream HTTP statuses that trigger fallback. Defaults to 429, 502, 503, 504. Invalid or empty values fall back to the defaults.",
          zh: "触发回退的上游 HTTP 状态码（响应输出前）。默认 429、502、503、504；配置非法或为空时回退到默认值。"
        },
        items: {
          type: "integer",
          title: { en: "HTTP status", zh: "HTTP 状态码" },
          minimum: 400, maximum: 599
        },
        uniqueItems: true,
        default: [429, 502, 503, 504]
      },
      cooldownSeconds: {
        type: "integer",
        title: { en: "Failed-target cooldown (seconds)", zh: "失败目标冷却秒数" },
        description: {
          en: "Best-effort, in-process cooldown for a target that returned a retryable status. 0 disables it. Not shared across instances or restarts.",
          zh: "对返回可回退状态码的上游目标做进程内尽力而为的短期冷却，0 表示关闭；不跨实例、不跨重启共享。"
        },
        minimum: 0, maximum: 600, default: 0
      },
      fallbackTraceEnabled: {
        type: "boolean",
        title: { en: "Attach fallback trace on failure", zh: "失败时附带回退轨迹" },
        description: {
          en: "When a fallback chain ultimately fails, append a vmr_fallback summary to the error message. Successful fallbacks stay native and are not modified.",
          zh: "回退链最终失败时，在错误消息末尾追加 vmr_fallback 摘要；成功回退仍为原生上游响应，不做修改。"
        },
        default: false
      },
      fallbackWebhookUrl: {
        type: "string",
        format: "url",
        title: { en: "Fallback event webhook (optional)", zh: "回退事件 webhook（可选）" },
        description: {
          en: "Optional absolute http(s) URL notified with a GET query on each fallback; provider hooks cannot send POST bodies. Best-effort and subject to host SSRF checks, so only public hosts work. Empty disables it.",
          zh: "可选 http(s) 绝对地址，每次回退以 GET 查询参数通知；provider hook 不允许 POST 请求体。尽力而为且受宿主 SSRF 检查限制，仅公网地址可用。留空即关闭。"
        },
        default: ""
      }
    }
  }
};

const UPSTREAM_ENDPOINT = "/v1/chat/completions";
const DEFAULT_FALLBACK_STATUSES = Object.freeze([429, 502, 503, 504]);
const COOLDOWN_MAX_ENTRIES = 256;
const TRACE_MAX_EVENTS = 8;
const TRACE_MESSAGE_LIMIT = 4000;
const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const hasOwn = (v, key) => Object.prototype.hasOwnProperty.call(v, key);
const integerInRange = (v, min, max, fallback) =>
  Number.isInteger(v) && v >= min && v <= max ? v : fallback;

/** Best-effort in-process cooldown marks. Keys are plain strings, values are
 * plain numbers only: never retain request bodies, ctx or other host objects,
 * because plugin runtimes are pooled across requests. Not shared across
 * instances or restarts. */
const cooldownMarks = new Map();

/** Host clock when available, otherwise a local fallback. Returns 0 when no
 * usable clock exists; cooldown then degrades to disabled rather than guessing. */
function nowSeconds() {
  let t = 0;
  try {
    if (typeof utils !== "undefined" && utils && typeof utils.unixNow === "function") {
      t = Number(utils.unixNow());
    } else if (typeof Date !== "undefined" && typeof Date.now === "function") {
      t = Date.now() / 1000;
    }
  } catch {}
  return Number.isFinite(t) && t > 0 ? t : 0;
}

/** Validate the configurable retryable-status list. Invalid/empty input falls
 * back to the v0.3.0 defaults so a bad config can never disable fallback. */
export function normalizeFallbackStatuses(value) {
  if (!Array.isArray(value)) return DEFAULT_FALLBACK_STATUSES;
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    if (!Number.isInteger(raw) || raw < 400 || raw > 599 || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out.length ? out : DEFAULT_FALLBACK_STATUSES;
}

function cooldownKey(alias, name) {
  return String(alias) + "\u0000" + String(name);
}

/** Time-delta based, so the clock unit (seconds or milliseconds on the host)
 * only needs to be consistent between two calls. */
function isCooling(alias, name, now, seconds) {
  if (!(seconds > 0) || !now) return false;
  const mark = cooldownMarks.get(cooldownKey(alias, name));
  return Number.isFinite(mark) && now - mark >= 0 && now - mark < seconds;
}

function markCooling(alias, name, now, seconds) {
  if (!(seconds > 0) || !now) return;
  if (cooldownMarks.size >= COOLDOWN_MAX_ENTRIES) {
    for (const [key, mark] of cooldownMarks) {
      if (!Number.isFinite(mark) || now - mark >= seconds) cooldownMarks.delete(key);
    }
    // Still full (all entries live): drop the oldest insertion to stay bounded.
    while (cooldownMarks.size >= COOLDOWN_MAX_ENTRIES) {
      const oldest = cooldownMarks.keys().next();
      if (oldest.done) break;
      cooldownMarks.delete(oldest.value);
    }
  }
  cooldownMarks.set(cooldownKey(alias, name), now);
}

/** Prefer a non-cooling candidate; if every candidate is cooling, keep the
 * original choice so cooldown can never make an alias unavailable. */
function chooseWithCooldown(models, alias, excluded, now, seconds) {
  const primary = chooseModel(models, excluded);
  if (primary === null || !(seconds > 0) || !now) return primary;
  const blocked = new Set(excluded);
  for (const model of models) {
    if (!blocked.has(model.name) && isCooling(alias, model.name, now, seconds))
      blocked.add(model.name);
  }
  const alternative = chooseModel(models, [...blocked]);
  return alternative === null ? primary : alternative;
}

/** Best-effort fallback notification. Provider hooks cannot POST: the host
 * only allows POST with a body in login/refresh/revoke/exchangeKey/scheduled/
 * ingress/egress/reply/report. The event therefore rides as GET query
 * parameters. SSRF checks still apply, so only public hosts work. Returns an
 * observable outcome so the trace can show whether the hook fired. */
function emitFallbackEvent(state, event) {
  const url = state.fallbackWebhookUrl;
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) return null;
  try {
    if (typeof utils === "undefined" || !utils || typeof utils.fetch !== "function")
      return { ok: false, error: "utils.fetch unavailable" };
    const fields = { plugin: "virtual-model-router", event: "fallback", ...event };
    const query = Object.keys(fields)
      .filter(k => fields[k] !== undefined && fields[k] !== null && fields[k] !== "")
      .map(k => encodeURIComponent(k) + "=" + encodeURIComponent(String(fields[k])))
      .join("&");
    const res = utils.fetch({ url: url + (url.indexOf("?") === -1 ? "?" : "&") + query, method: "GET" });
    return { ok: true, status: isRecord(res) ? res.status : undefined };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e).slice(0, 180) };
  }
}

/** Attach the per-request trace only when the fallback chain ultimately fails.
 * With nativeResponse set, the host ignores a {body} returned for a non-2xx
 * reply and honours only {error}/{next}; live rc.51 testing confirmed that a
 * modified body never reaches the client while the error message does. Return
 * a ConvertError that carries the trace at the end of the message. */
function attachTrace(reply, state, status) {
  if (!state.fallbackTraceEnabled
      || !Array.isArray(state.fallbackTrace) || !state.fallbackTrace.length) return reply;
  let suffix;
  try {
    const payload = { alias: state.alias, attempted: state.attempted, events: state.fallbackTrace };
    suffix = " | vmr_fallback=" + JSON.stringify(payload);
    if (suffix.length > TRACE_MESSAGE_LIMIT) suffix = suffix.slice(0, TRACE_MESSAGE_LIMIT) + "…";
  } catch { return reply; }
  // JSON upstream error arrives as { body: { error } }, non-JSON as { error }.
  const source = isRecord(reply.body) && isRecord(reply.body.error) ? reply.body.error
    : isRecord(reply.error) ? reply.error
    : isRecord(reply.body) && hasOwn(reply.body, "message") ? reply.body
    : null;
  if (!source) return reply;
  const error = { status, message: String(source.message ?? "") + suffix };
  if (typeof source.type === "string" && source.type) error.type = source.type;
  if (typeof source.code === "string" && source.code) error.code = source.code;
  return { error };
}

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

/** Convert flat visual-table rows to the existing grouped model representation. */
export function resolveModelGroups(config) {
  const mode = config?.editorMode ?? "json";
  if (mode === "json") return config?.groups;
  if (mode !== "table") throw new Error("unknown virtual model editor mode: " + String(mode));
  const routes = config?.routes;
  if (routes === undefined || (Array.isArray(routes) && routes.length === 0))
    return Object.create(null);
  if (!Array.isArray(routes))
    throw new Error("virtual model routes table must be an array");
  const groups = Object.create(null);
  routes.forEach((route, i) => {
    if (!isRecord(route) || typeof route.alias !== "string" || !route.alias.trim())
      throw new Error("virtual model routes[" + i + "].alias must be non-empty");
    const alias = route.alias.trim();
    if (!hasOwn(groups, alias)) groups[alias] = { models: [] };
    groups[alias].models.push({
      name: route.name,
      priority: route.priority,
      weight: route.weight
    });
  });
  return groups;
}

/** Virtual aliases route inside this channel; other selected channel models pass through unchanged. */
export function convertRequest(ctx, request) {
  const alias = request.model;
  if (!isRecord(request.body))
    throw new Error("Virtual Model Router supports JSON Chat Completions bodies only");
  if (typeof alias !== "string" || request.body.model !== alias)
    throw new Error("Do not configure channel model_mapping for virtual aliases");
  const groups = resolveModelGroups(ctx.config);
  if (!isRecord(groups) || !hasOwn(groups, alias)) {
    // New API already selected this channel for the requested model. Preserve
    // the gateway's channel-model allowlist and its token/group authorization.
    // Never retry a direct model against unrelated virtual-group candidates.
    return {
      body: { ...request.body }, path: UPSTREAM_ENDPOINT,
      stream: request.stream === true, nativeResponse: true,
      state: { direct: true, alias, attempted: [alias], maxRetries: 0 }
    };
  }
  const models = normalizeGroup(groups, alias);
  const config = isRecord(ctx.config) ? ctx.config : {};
  const fallbackStatuses = normalizeFallbackStatuses(config.fallbackStatuses);
  const cooldownSeconds = integerInRange(config.cooldownSeconds, 0, 600, 0);
  const now = cooldownSeconds > 0 ? nowSeconds() : 0;
  const chosen = chooseWithCooldown(models, alias, [], now, cooldownSeconds);
  if (chosen === null) throw new Error("virtual model " + alias + ": no eligible candidates");
  const body = { ...request.body, model: chosen.name };
  const maxRetries = integerInRange(config.maxRetries, 0, 2, 1);
  const maxReplayBytes = integerInRange(config.maxReplayBytes, 0, 65536, 32768);
  const replayBody = maxRetries > 0 && utf8Length(JSON.stringify(body), maxReplayBytes) <= maxReplayBytes
    ? body : null;
  return {
    body, path: UPSTREAM_ENDPOINT, stream: request.stream === true, nativeResponse: true,
    state: {
      alias, models, attempted: [chosen.name], maxRetries,
      stream: request.stream === true, replayBody,
      fallbackStatuses, cooldownSeconds,
      fallbackTraceEnabled: config.fallbackTraceEnabled === true,
      fallbackWebhookUrl: typeof config.fallbackWebhookUrl === "string" ? config.fallbackWebhookUrl : "",
      fallbackTrace: []
    }
  };
}

/** Only fail over on retryable pre-output HTTP responses, never broken streams. */
export function convertResponse(ctx, response) {
  const state = ctx.state;
  const statuses = normalizeFallbackStatuses(state?.fallbackStatuses);
  if (statuses.includes(response.status)
      && isRecord(state) && isRecord(state.replayBody)
      && Array.isArray(state.models) && Array.isArray(state.attempted)
      && state.attempted.length <= state.maxRetries) {
    const seconds = integerInRange(state.cooldownSeconds, 0, 600, 0);
    const now = seconds > 0 ? nowSeconds() : 0;
    const failed = state.attempted[state.attempted.length - 1];
    markCooling(state.alias, failed, now, seconds);
    const chosen = chooseWithCooldown(state.models, state.alias, state.attempted, now, seconds);
    if (chosen !== null) {
      const trace = Array.isArray(state.fallbackTrace) ? state.fallbackTrace : [];
      const event = { alias: state.alias, from: failed, status: response.status, to: chosen.name };
      if (now) event.at = now;
      const hook = emitFallbackEvent(state, event);
      if (hook) event.webhook = hook;
      const events = trace.length < TRACE_MAX_EVENTS ? [...trace, event] : trace;
      return {
        next: {
          path: UPSTREAM_ENDPOINT, body: { ...state.replayBody, model: chosen.name },
          stream: state.stream, nativeResponse: true
        },
        state: { ...state, attempted: [...state.attempted, chosen.name], fallbackTrace: events }
      };
    }
  }
  // Only a failed terminal reply carries a trace. Successful upstream responses
  // are normally native (this hook is not called), but keep the guarantee here
  // too so a 2xx seen by the hook is never modified.
  const reply = upstreamReply(response);
  if (response.status < 400 || !isRecord(state)) return reply;
  return attachTrace(reply, state, response.status);
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
