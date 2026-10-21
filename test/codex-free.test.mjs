import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { selectCodexQuotaWindows as nodeSelectCodexQuotaWindows } from "../lib/codex.js";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

const clip = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));

/** 按「函数声明 + 平衡大括号」精确抽取一个函数（跳过参数列表里的默认值）。 */
function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > 0, `function ${name} must exist in lib/client.js`);
  let index = source.indexOf("(", start);
  let parens = 0;
  for (; index < source.length; index += 1) {
    if (source[index] === "(") parens += 1;
    else if (source[index] === ")") {
      parens -= 1;
      if (parens === 0) break;
    }
  }
  index = source.indexOf("{", index);
  let depth = 0;
  for (; index < source.length; index += 1) {
    const ch = source[index];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unbalanced braces for ${name}`);
}

/** 从 from 起截取一段括号平衡的调用表达式（用于评估渲染分支的真实结构）。 */
function extractBalancedCall(from) {
  const start = source.indexOf("react.createElement", from);
  assert.ok(start > 0, "render expression must exist in lib/client.js");
  let index = source.indexOf("(", start);
  let depth = 0;
  for (; index < source.length; index += 1) {
    const ch = source[index];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error("unbalanced render expression");
}

const SELECTOR_FUNCTIONS = ["codexDisplayablePercent", "codexWindowPercent", "codexFreeQuotaPercent", "selectCodexQuotaWindows"];
const selectors = clip("const CODEX_FIVE_HOUR_SECONDS =", "async function callCodexSubscription")
  + SELECTOR_FUNCTIONS.map(extractFunction).join("\n");
const selectorContext = vm.createContext({ Array, Object, Number, String, Math, Set, isNaN });
vm.runInContext(selectors, selectorContext);

const FREEFORM_WINDOW = 30 * 24 * 60 * 60; // 未订阅账号返回的月度窗口（2592000 秒）
const usageWith = (windows) => ({ rateLimits: [{ id: "codex", name: "Codex", windows }] });

test("未订阅（仅月度窗口）：识别为免费额度并取该窗口剩余百分比", () => {
  const usage = usageWith([{ windowSeconds: FREEFORM_WINDOW, remainingPercent: 87.5 }]);
  assert.deepEqual({ ...selectorContext.selectCodexQuotaWindows(usage) }, { fiveHour: null, weekly: null, free: 87.5, mode: "free" });
});

test("月度窗口带标签时间偏差（±5% 内）仍然识别", () => {
  for (const windowSeconds of [FREEFORM_WINDOW * 0.95, FREEFORM_WINDOW, FREEFORM_WINDOW * 1.05]) {
    const usage = usageWith([{ windowSeconds, remainingPercent: 40 }]);
    assert.equal(selectorContext.selectCodexQuotaWindows(usage).free, 40, `${windowSeconds} should match the free quota window`);
    assert.equal(selectorContext.selectCodexQuotaWindows(usage).mode, "free");
  }
});

test("已订阅（5h + 周窗口）：免费额度不展示，5h / 周额度照常解析", () => {
  const usage = usageWith([
    { windowSeconds: 18_000, remainingPercent: 75 },
    { windowSeconds: 604_800, remainingPercent: 42 },
  ]);
  assert.deepEqual({ ...selectorContext.selectCodexQuotaWindows(usage) }, { fiveHour: 75, weekly: 42, free: null, mode: "subscription" });
});

test("仅出现 5h 或仅出现周窗口时同样按订阅处理（免费额度不展示）", () => {
  for (const windows of [
    [{ windowSeconds: 18_000, remainingPercent: 60 }],
    [{ windowSeconds: 604_800, remainingPercent: 60 }],
  ]) {
    const projection = selectorContext.selectCodexQuotaWindows(usageWith(windows));
    assert.equal(projection.mode, "subscription");
    assert.equal(projection.free, null);
  }
});

test("月度窗口时长意外时回退该额度首个可用窗口（有数据就不显示 —）", () => {
  const usage = usageWith([
    { windowSeconds: 3_600, remainingPercent: 12 },
    { windowSeconds: 86_400, remainingPercent: 34 },
  ]);
  assert.deepEqual({ ...selectorContext.selectCodexQuotaWindows(usage) }, { fiveHour: null, weekly: null, free: 12, mode: "free" });
});

test("额度窗口数据异常时免费额度为 null（渲染为 —），模式仍为 free", () => {
  const usage = usageWith([
    { windowSeconds: FREEFORM_WINDOW, remainingPercent: 120 },
    { windowSeconds: FREEFORM_WINDOW, remainingPercent: "50" },
  ]);
  assert.deepEqual({ ...selectorContext.selectCodexQuotaWindows(usage) }, { fiveHour: null, weekly: null, free: null, mode: "free" });
});

test("其它额度的月度窗口不会误判为 codex 免费额度", () => {
  const usage = {
    rateLimits: [
      { id: "gpt-reserve", name: "gpt-reserve", windows: [{ windowSeconds: FREEFORM_WINDOW, remainingPercent: 30 }] },
      { id: "code_review", windows: [{ windowSeconds: FREEFORM_WINDOW, remainingPercent: 20 }] },
    ],
  };
  assert.deepEqual({ ...selectorContext.selectCodexQuotaWindows(usage) }, { fiveHour: null, weekly: null, free: null, mode: "free" });
});

test("浏览器实现与 lib/codex.js 镜像保持一致", () => {
  const samples = [
    null,
    { rateLimits: [] },
    usageWith([{ windowSeconds: FREEFORM_WINDOW, remainingPercent: 87.5 }]),
    usageWith([{ windowSeconds: 18_000, remainingPercent: 75 }, { windowSeconds: 604_800, remainingPercent: 42 }]),
    usageWith([{ windowSeconds: 18_000, remainingPercent: 75 }, { windowSeconds: FREEFORM_WINDOW, remainingPercent: 42 }]),
    usageWith([{ windowSeconds: 3_600, remainingPercent: 12 }]),
    usageWith([{ windowSeconds: FREEFORM_WINDOW, remainingPercent: 120 }]),
  ];
  for (const usage of samples) {
    assert.deepEqual(
      { ...selectorContext.selectCodexQuotaWindows(usage) },
      { ...nodeSelectCodexQuotaWindows(usage) },
      `browser and node projections must agree for ${JSON.stringify(usage)}`,
    );
  }
});

test("免费额度行与 5h / 周额度行互斥渲染，且行结构与既有额度行一致", () => {
  // 免费模式分支：hud-row hud-usage-row + ChatGPT 图标 + 标签 + hud-balance-value 百分比
  assert.match(source, /const codexFreeMode = codexQuota\?\.mode === "free";/);
  assert.match(source, /codexFreeMode\s*\n\s*\? react\.createElement\("div", \{ className: "hud-row hud-usage-row" \},/);
  // else 分支仍是 5h / 周额度两行（同一 ternary 内 → 与免费额度互斥）
  assert.match(source, /: react\.createElement\(react\.Fragment, null,\s*\n\s*react\.createElement\("div", \{ className: "hud-row hud-usage-row" \},\s*\n\s*react\.createElement\(Icon, \{ name: "ChatGPT" \}\), react\.createElement\("span", \{ className: "hud-row-label" \}, t\("codexFiveHour"\)\),/);

  // 从声明之后的渲染分支处截取（跳过声明本身，否则会命中 jumpBtn 等更早的 createElement）
  const declaration = source.indexOf("const codexFreeMode = ");
  assert.ok(declaration > 0, "codexFreeMode must be declared in lib/client.js");
  const renderSite = source.indexOf("codexFreeMode", declaration + "const codexFreeMode".length);
  assert.ok(renderSite > declaration, "codexFreeMode must be used in the render branch");
  const row = vm.runInNewContext(`(${extractBalancedCall(renderSite)})`, {
    react: { createElement: (type, props, ...children) => ({ type, props, children }) },
    Icon: "Icon",
    t: key => key,
    codexQuota: { free: 42 },
    fmtCodexPercent: value => `${value}%`,
    openSettingsAccount() {},
  });
  assert.equal(row.children.length, 3);
  assert.equal(row.children[0].type, "Icon");
  assert.equal(row.children[0].props.name, "ChatGPT");
  assert.equal(row.children[1].props.className, "hud-row-label");
  assert.equal(row.children[1].children[0], "codexFreeQuota");
  assert.equal(row.children[2].props.className, "hud-balance-value hud-click");
  assert.equal(row.children[2].props.title, "valueOpenCodex");
  assert.equal(row.children[2].children[0], "42%");

  // 中英文案齐备
  assert.match(source, /codexFreeQuota: "codex 免费额度",/);
  assert.match(source, /codexFreeQuota: "Codex free quota",/);
});

/** 挂载 HUD 的 codex 轮询 effect（与 test/codex-transport.test.mjs 同一抽取方式）。 */
function mountCodexPolling(call) {
  // 合并 main 的共享快照架构后：effect 通过 refreshModuleSnapshot 写入 moduleSnapshots，
  // 降级时从 moduleSnapshots 读取上一次快照以保留展示模式。
  const moduleSnapshots = new Map();
  const context = vm.createContext({
    ctx: { get: () => ({ rpc: { call } }) },
    react: { useEffect: fn => fn() },
    window: { setInterval() {}, clearInterval() {} },
    moduleSnapshots,
    refreshModuleSnapshot: (key, read) => Promise.resolve().then(read).then((value) => {
      moduleSnapshots.set(key, value);
      return value;
    }),
  });
  const helperStart = source.indexOf("const CODEX_FIVE_HOUR_SECONDS");
  const helperEnd = source.indexOf("function fmtCodexPercent", helperStart);
  vm.runInContext(source.slice(helperStart, helperEnd), context);
  const start = source.lastIndexOf("react.useEffect(() => {", source.indexOf("const emptyQuota"));
  const end = source.indexOf("}, []);", start) + "}, []);".length;
  const snippet = source.slice(start, end);
  return {
    poll: () => vm.runInContext(snippet, context),
    get state() { return moduleSnapshots.get("codex"); },
  };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test("订阅账号轮询失败降级时保留订阅模式（不误显示免费额度）", async () => {
  let usageFails = false;
  const harness = mountCodexPolling(async (channel, endpoint) => {
    if (endpoint.endsWith("status")) return { ok: true, value: { authenticated: true } };
    if (usageFails) throw new Error("transport failure: HTTP 503");
    return { ok: true, value: { rateLimits: [
      { id: "codex", windows: [{ windowSeconds: 18_000, remainingPercent: 75 }, { windowSeconds: 604_800, remainingPercent: 42 }] },
    ] } };
  });

  harness.poll();
  await flush();
  assert.equal(harness.state.usage.mode, "subscription");
  assert.equal(harness.state.usage.fiveHour, 75);

  usageFails = true;
  harness.poll();
  await flush();
  assert.equal(harness.state.available, true);
  assert.equal(harness.state.degraded, true);
  assert.equal(harness.state.usage.mode, "subscription");
  assert.equal(harness.state.usage.fiveHour, null);
  assert.equal(harness.state.usage.free, null);
});

test("未订阅账号轮询失败降级时保留免费模式", async () => {
  let usageFails = false;
  const harness = mountCodexPolling(async (channel, endpoint) => {
    if (endpoint.endsWith("status")) return { ok: true, value: { authenticated: true } };
    if (usageFails) return { ok: false, error: { message: "upstream unavailable" } };
    return { ok: true, value: { rateLimits: [{ id: "codex", windows: [{ windowSeconds: FREEFORM_WINDOW, remainingPercent: 87.5 }] }] } };
  });

  harness.poll();
  await flush();
  assert.equal(harness.state.usage.mode, "free");
  assert.equal(harness.state.usage.free, 87.5);

  usageFails = true;
  harness.poll();
  await flush();
  assert.equal(harness.state.available, true);
  assert.equal(harness.state.degraded, true);
  assert.equal(harness.state.usage.mode, "free");
  assert.equal(harness.state.usage.free, null);
});
