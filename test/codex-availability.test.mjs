// dsh-awesome-hud — v0.20.1 修复：停用 dsh-codex-subscription 后「Codex 额度」仍显示可展示
// 覆盖：
//  1) 先有数据、再停用插件（路由 404）→ 必须转为不可用，不能保留 available=true
//  2) 已认证后额度（usage）请求失败 → 仍降级保留上一次的展示模式（既有文档行为，不回归）
//  3) 三档原因键（missing / unauthenticated / unavailable）
//  4) 「打开 HUD 设置时立即刷新」的接线
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { extractArrowHandler, extractFunction, hudClient, clientSource as source } from "./helpers/client-harness.mjs";

const flush = () => new Promise(resolve => setImmediate(resolve));
const RATE_LIMITS = [
  { id: "codex", windows: [
    { windowSeconds: 18_000, remainingPercent: 75 },
    { windowSeconds: 604_800, remainingPercent: 42 },
  ] },
];

/**
 * 挂载 codex 轮询 effect（与 codex-free / codex-transport 同一抽取方式），
 * 并用 window.setInterval 捕获 poller，便于模拟「先成功后失败」的连续轮询。
 */
function mount(call, options = {}) {
  const box = { state: undefined, poll: null };
  const context = vm.createContext({
    ctx: { get: options.get ?? (() => ({ rpc: { call } })) },
    react: { useEffect: fn => fn() },
    window: { setInterval: fn => { box.poll = fn; return 1; }, clearInterval() {} },
    singleFlight: fn => fn,
    setCodex: value => { box.state = typeof value === "function" ? value(box.state) : value; },
  });
  const helperStart = source.indexOf("const CODEX_FIVE_HOUR_SECONDS");
  const helperEnd = source.indexOf("function fmtCodexPercent", helperStart);
  vm.runInContext(source.slice(helperStart, helperEnd), context);
  const start = source.lastIndexOf("react.useEffect(() => {", source.indexOf("const emptyQuota"));
  const end = source.indexOf("}, []);", start) + "}, []);".length;
  const snippet = source.slice(start, end);
  vm.runInContext(snippet, context);
  return {
    /** 再跑一轮（等价于下一个 60 秒轮询）。 */
    poll: () => box.poll(),
    get state() { return box.state; },
  };
}

/** 根据 behavior 返回 status / usage 的响应（usage 默认成功）。 */
function responder(getBehavior) {
  return async (channel, endpoint) => {
    const behavior = getBehavior();
    if (endpoint.endsWith("status")) {
      if (behavior === "gone") throw new Error("transport failure for /codex-subscription/status: HTTP 404");
      if (behavior === "unauthorized") throw new Error("transport failure: HTTP 401");
      if (behavior === "offline") throw new Error("network unreachable");
      if (behavior === "signed-out") return { ok: true, value: { authenticated: false } };
      return { ok: true, value: { authenticated: true } };
    }
    if (behavior === "usage-fail") return { ok: false, error: { message: "upstream unavailable" } };
    return { ok: true, value: { rateLimits: RATE_LIMITS } };
  };
}

test("先成功、后停用（404）：不再保留可展示状态", async () => {
  let behavior = "ok";
  const harness = mount(responder(() => behavior));
  await flush();
  assert.equal(harness.state.available, true, "首轮读取成功");
  assert.equal(harness.state.usage.fiveHour, 75);

  // 用户在插件管理页停用插件 → 路由随卸载注销 → 下一轮 status 得到 404。
  behavior = "gone";
  harness.poll();
  await flush();
  assert.equal(harness.state.available, false, "停用后必须转为不可用（修复前会保留 true）");
  assert.equal(harness.state.missing, true);
  assert.equal(harness.state.reason, "missing");
  assert.equal(harness.state.usage, null, "不再保留旧的 Codex 额度行");
});

test("先成功、后网络失败：转为不可用并标为「当前不可用」，不回退成可展示", async () => {
  let behavior = "ok";
  const harness = mount(responder(() => behavior));
  await flush();
  assert.equal(harness.state.available, true);

  behavior = "offline";
  harness.poll();
  await flush();
  assert.equal(harness.state.available, false);
  assert.equal(harness.state.missing, false, "网络失败不是路由缺失");
  assert.equal(harness.state.reason, "unavailable");
});

test("传输层 401 不等于路由缺失：原因为「当前不可用」而非需安装并启用", async () => {
  const harness = mount(responder(() => "unauthorized"));
  await flush();
  assert.equal(harness.state.available, false);
  assert.equal(harness.state.missing, false, "401 是认证问题，不是插件未启用");
  assert.equal(harness.state.reason, "unavailable");
});

test("插件在但未登录：原因是未登录，不是插件缺失", async () => {
  const harness = mount(responder(() => "signed-out"));
  await flush();
  assert.equal(harness.state.available, false);
  assert.equal(harness.state.missing, false);
  assert.equal(harness.state.reason, "unauthenticated");
});

test("已认证后额度请求失败：仍降级保留上一次的展示模式（文档行为不回归）", async () => {
  let behavior = "ok";
  const harness = mount(responder(() => behavior));
  await flush();
  assert.equal(harness.state.available, true);

  behavior = "usage-fail";
  harness.poll();
  await flush();
  assert.equal(harness.state.available, true, "额度接口偶发失败仍保留行");
  assert.equal(harness.state.degraded, true);
  assert.equal(harness.state.reason, null);
  assert.equal(harness.state.usage.fiveHour, null, "数值清空为 —");
  assert.equal(harness.state.usage.weekly, null);
});

test("连接服务不可用（无 rpc）：按插件缺失处理", async () => {
  const harness = mount(async () => { throw new Error("should not be called"); }, { get: () => undefined });
  await flush();
  assert.equal(harness.state.available, false);
  assert.equal(harness.state.missing, true);
  assert.equal(harness.state.reason, "missing");
});

test("状态机：不可用分支无条件写入，降级分支才参考 previous", () => {
  const unavailable = extractArrowHandler("markCodexUnavailable");
  assert.match(unavailable, /available: false/, "不可用必须写 available:false");
  assert.doesNotMatch(unavailable, /previous/, "不可用分支不能参考上一次状态（修复的核心）");
  const degraded = extractArrowHandler("markCodexDegraded");
  assert.match(degraded, /previous\?\.available === true/, "降级分支保留原语义");
  assert.match(degraded, /emptyQuota/, "降级只清空数值、保留展示模式");
});

test("原因键：missing / unauthenticated / 其余一律「当前不可用」", () => {
  const reasonKey = vm.runInNewContext(`${extractFunction("codexUsageReasonKey")}\ncodexUsageReasonKey;`);
  assert.equal(reasonKey({ reason: "missing" }), "settingsUsageCodexMissing");
  assert.equal(reasonKey({ reason: "unauthenticated" }), "settingsUsageCodexUnconfigured");
  assert.equal(reasonKey({ reason: "unavailable" }), "settingsUsageCodexUnavailable");
  assert.equal(reasonKey(null), "settingsUsageCodexUnavailable", "尚未取到状态时按不可用展示");
  assert.equal(reasonKey({}), "settingsUsageCodexUnavailable");
  // 中英字典都要有这三档文案（红字原因不能落成键名）。
  const { zh, en } = hudClient().dictionaries[0];
  for (const key of ["settingsUsageCodexMissing", "settingsUsageCodexUnconfigured", "settingsUsageCodexUnavailable"]) {
    assert.equal(typeof zh[key], "string", `${key} 需要中文文案`);
    assert.equal(typeof en[key], "string", `${key} 需要英文文案`);
    assert.ok(zh[key].length > 0 && en[key].length > 0, `${key} 文案不能为空`);
  }
});

test("打开 HUD 设置即刷新：poller 注册、回调与齿轮接线", () => {
  // 三路 poller 注册表与「打开设置时刷新」的回调。
  assert.match(source, /const usageRefreshRef = react\.useRef\(\{ balance: null, opencode: null, codex: null \}\);/);
  assert.match(source, /const refreshUsageNow = react\.useCallback\(\(\) => \{/);
  assert.match(source, /refresh\.balance\?\.\(\);/);
  assert.match(source, /refresh\.opencode\?\.\(\);/);
  assert.match(source, /refresh\.codex\?\.\(\);/);
  assert.match(source, /usageRefreshRef\.current\.codex = pollCodex;/);
  // 抽取式测试里没有 usageRefreshRef，必须用 typeof 守卫（否则旧测试直接 ReferenceError）。
  assert.match(source, /typeof usageRefreshRef !== "undefined"/);
  // 弹窗由「会话」模块的齿轮打开：先刷新、再开弹窗。
  assert.match(source, /onClick: \(\) => \{ props\.onUsageRefresh\?\.\(\); setSettingsOpen\(true\); \},/);
  assert.match(source, /onUsageRefresh: refreshUsageNow,/);
  // 设置项仍只看数据可用性（不因 degraded 而放开）。
  assert.match(source, /codex: codex !== null && codex\.available === true,/);
});
