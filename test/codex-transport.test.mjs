import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

async function refreshQuota(call, options = {}) {
  let state;
  const context = vm.createContext({
    ctx: { get: options.get ?? (() => ({ rpc: { call } })) },
    react: { useEffect: fn => fn() },
    window: { setInterval() {}, clearInterval() {} },
    singleFlight: fn => fn,
    setCodex: value => { state = typeof value === "function" ? value(state) : value; },
  });
  const helperStart = source.indexOf("const CODEX_FIVE_HOUR_SECONDS");
  const helperEnd = source.indexOf("function fmtCodexPercent", helperStart);
  vm.runInContext(source.slice(helperStart, helperEnd), context);
  const start = source.lastIndexOf("react.useEffect(() => {", source.indexOf("const emptyQuota"));
  const end = source.indexOf("}, []);", start) + "}, []);".length;
  vm.runInContext(source.slice(start, end), context);
  await new Promise(resolve => setImmediate(resolve));
  return state;
}

function reply(endpoint) {
  return endpoint.endsWith("status")
    ? { ok: true, value: { authenticated: true } }
    : { ok: true, value: { rateLimits: [
      { id: "code_review", windows: [{ windowSeconds: 18000, remainingPercent: 1 }] },
      { id: "codex", windows: [{ windowSeconds: 18000, remainingPercent: 75 }, { windowSeconds: 604800, remainingPercent: 42 }] },
    ] } };
}

test("new subscription transport displays both Codex quota windows", async () => {
  const calls = [];
  const state = await refreshQuota(async (channel, endpoint, payload) => {
    calls.push([channel, endpoint, JSON.parse(JSON.stringify(payload))]);
    if (channel !== "/api") throw new Error("transport failure: HTTP 404");
    return reply(endpoint);
  });
  assert.equal(state.available, true);
  assert.equal(state.usage.fiveHour, 75);
  assert.equal(state.usage.weekly, 42);
  assert.deepEqual(calls, [["/api", "codex-subscription/status", {}], ["/api", "codex-subscription/usage", { force: false }]]);
});

test("legacy subscription remains supported when the new route returns 404", async () => {
  const state = await refreshQuota(async (channel, endpoint) => {
    if (channel === "/api") throw new Error(`transport failure for /api/${endpoint}: HTTP 404`);
    return reply(endpoint);
  });
  assert.equal(state.available, true);
  assert.equal(state.usage.weekly, 42);
});

test("reserve limits survive quota polling and reach the display selector", async () => {
  for (const percent of [36, 0, 100, null]) {
    const state = await refreshQuota(async (channel, endpoint) => {
      const response = reply(endpoint);
      if (endpoint.endsWith("usage") && percent !== null) {
        response.value.rateLimits.push({ id: "base_model_inference", name: "gpt-reserve",
          windows: [{ windowSeconds: 604800, remainingPercent: percent }] });
      }
      return response;
    });
    const context = vm.createContext({ usage: state.usage });
    vm.runInContext(source.slice(source.indexOf("const CODEX_FIVE_HOUR_SECONDS"), source.indexOf("function fmtCodexPercent")), context);
    const rows = vm.runInContext("selectCodexReserveLimits(usage)", context);
    assert.equal(rows.length, percent === null ? 0 : 1);
    if (percent !== null) assert.equal(rows[0].remainingPercent, percent);
    assert.equal(state.usage.fiveHour, 75);
    assert.equal(state.usage.weekly, 42);
  }
});

test("authentication and server errors never retry through legacy transport", async () => {
  for (const result of [401, 403, 500, "offline", "signed-out", "domain-error"]) {
    const channels = [];
    const state = await refreshQuota(async channel => {
      channels.push(channel);
      if (result === "signed-out") return { ok: true, value: { authenticated: false } };
      if (result === "domain-error") return { ok: false, error: { message: "HTTP 404 upstream" } };
      throw new Error(`transport failure: HTTP ${result}`);
    });
    assert.deepEqual(channels, ["/api"]);
    assert.equal(state.available, false);
  }
});

test('插件未启用与未登录分开标记：404 视为插件不可用，未登录不算', async () => {
  // 路由 404（插件未安装/未启用）→ missing: true，HUD 设置据此提示「安装并启用」。
  const missing = await refreshQuota(async () => {
    throw new Error('transport failure for /codex-subscription/status: HTTP 404');
  });
  assert.equal(missing.available, false);
  assert.equal(missing.missing, true);

  // 已启用但未登录 → missing: false，HUD 设置据此提示「未登录」。
  const signedOut = await refreshQuota(async () => ({ ok: true, value: { authenticated: false } }));
  assert.equal(signedOut.available, false);
  assert.equal(signedOut.missing, false);

  // 连接服务本身不可用（没有 rpc）→ 也按插件不可用处理。
  const noRpc = await refreshQuota(async () => { throw new Error('should not be called'); }, { get: () => undefined });
  assert.equal(noRpc.available, false);
  assert.equal(noRpc.missing, true);

  // 网络/上游失败既不是「插件不可用」也不是「未登录」，只是暂时不可用。
  const offline = await refreshQuota(async () => { throw new Error('network down'); });
  assert.equal(offline.available, false);
  assert.equal(offline.missing, false);
});
