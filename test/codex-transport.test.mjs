import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

async function refreshQuota(call) {
  let state;
  const context = vm.createContext({
    ctx: { get: () => ({ rpc: { call } }) },
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
