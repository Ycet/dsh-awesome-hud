import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

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

const RESERVE_FUNCTIONS = ["codexWindowPercent", "normalizedLimitName", "isCodexReserveLimit", "codexReservePrimaryPercent", "codexReserveDisplayName", "selectCodexReserveLimits", "selectCodexQuotaWindows"];
const selectors = clip("const CODEX_FIVE_HOUR_SECONDS =", "async function callCodexSubscription")
  + RESERVE_FUNCTIONS.map(extractFunction).join("\n");

const context = vm.createContext({ Array, Object, Number, String, Math, Set, isNaN });
vm.runInContext(selectors, context);

/** 构造 codex-subscription 的 usage 投影（additional_rate_limits → rateLimits）。 */
function usageWith(rateLimits) {
  return { rateLimits };
}

test("存在 gpt-reserve 额度时解析出主窗口剩余百分比", () => {
  const usage = usageWith([
    { id: "codex", windows: [{ remainingPercent: 100, windowSeconds: 18000 }, { remainingPercent: 80, windowSeconds: 604800 }] },
    { id: "gpt-reserve", name: "Reserve", windows: [{ remainingPercent: 42.6, windowSeconds: 604800 }] },
  ]);

  const limits = context.selectCodexReserveLimits(usage);
  assert.equal(limits.length, 1);
  assert.equal(limits[0].id, "gpt-reserve");
  assert.equal(limits[0].name, "Reserve");
  assert.equal(limits[0].remainingPercent, 42.6);
  // 5h / 周额度解析不受影响
  assert.deepEqual({ ...context.selectCodexQuotaWindows(usage) }, { fiveHour: 100, weekly: 80 });
});

test("没有 gpt-reserve 额度时不产生任何行（不展示）", () => {
  assert.deepEqual(Array.from(context.selectCodexReserveLimits(usageWith([
    { id: "codex", windows: [{ remainingPercent: 100, windowSeconds: 18000 }] },
    { id: "code_review", windows: [{ remainingPercent: 50, windowSeconds: 604800 }] },
  ]))), []);
  assert.deepEqual(Array.from(context.selectCodexReserveLimits(usageWith([]))), []);
  assert.deepEqual(Array.from(context.selectCodexReserveLimits({})), []);
  assert.deepEqual(Array.from(context.selectCodexReserveLimits(null)), []);
});

test("真实形状：id 为 base_model_inference、name 为 gpt-reserve 时被识别", () => {
  // /wham/usage → additional_rate_limits 里 metered_feature=base_model_inference、
  // limit_name=gpt-reserve；codex-subscription 转发为 { id, name, windows }
  const usage = usageWith([
    { id: "codex", windows: [{ remainingPercent: 100, windowSeconds: 18000 }, { remainingPercent: 80, windowSeconds: 604800 }] },
    { id: "base_model_inference", name: "gpt-reserve", windows: [{ remainingPercent: 36, windowSeconds: 604800 }] },
  ]);

  const limits = context.selectCodexReserveLimits(usage);
  assert.equal(limits.length, 1);
  assert.equal(limits[0].id, "base_model_inference");
  assert.equal(limits[0].remainingPercent, 36);
  // name 与默认文案同义 → 不重复展示为「（gpt-reserve）」
  assert.equal(limits[0].name, null);
  // 周额度仍只取 codex 那条 7 天窗口，不会误取 gpt-reserve 的 7 天窗口
  assert.deepEqual({ ...context.selectCodexQuotaWindows(usage) }, { fiveHour: 100, weekly: 80 });
});

test("id 或 name 命中 gpt-reserve 都识别，且拒绝子串误判", () => {
  for (const limit of [
    { id: "gpt-reserve", windows: [{ remainingPercent: 10, windowSeconds: 604800 }] },
    { id: "gpt_reserve", windows: [{ remainingPercent: 10, windowSeconds: 604800 }] },
    { id: "GPT-Reserve", windows: [{ remainingPercent: 10, windowSeconds: 604800 }] },
    { id: "base_model_inference", name: " gpt reserve ", windows: [{ remainingPercent: 10, windowSeconds: 604800 }] },
  ]) {
    const limits = context.selectCodexReserveLimits(usageWith([limit]));
    assert.equal(limits.length, 1, `${JSON.stringify(limit)} should be recognized`);
    assert.equal(limits[0].remainingPercent, 10);
  }

  // 子串 / 近似名不应误判
  for (const limit of [
    { id: "gpt-reserve-extra", windows: [{ remainingPercent: 10, windowSeconds: 604800 }] },
    { id: "base_model_inference", name: "gpt-reserve-backup", windows: [{ remainingPercent: 10, windowSeconds: 604800 }] },
    { id: "codex", windows: [{ remainingPercent: 10, windowSeconds: 604800 }] },
  ]) {
    assert.deepEqual(Array.from(context.selectCodexReserveLimits(usageWith([limit]))), [], `${JSON.stringify(limit)} must not match`);
  }
});

test("自定义额度名（非 gpt-reserve）作为附加名展示", () => {
  const limits = context.selectCodexReserveLimits(usageWith([
    { id: "gpt-reserve", name: "Team reserve", windows: [{ remainingPercent: 55, windowSeconds: 604800 }] },
  ]));
  assert.equal(limits.length, 1);
  assert.equal(limits[0].name, "Team reserve");
});

test("名称缺失或空白时回退到默认文案（name 为 null）", () => {
  const anonymous = context.selectCodexReserveLimits(usageWith([{ id: "gpt-reserve", windows: [{ remainingPercent: 10, windowSeconds: 604800 }] }]));
  assert.equal(anonymous[0].name, null);
  const blank = context.selectCodexReserveLimits(usageWith([{ id: "gpt-reserve", name: "   ", windows: [{ remainingPercent: 10, windowSeconds: 604800 }] }]));
  assert.equal(blank[0].name, null);
});

test("窗口数据异常时该额度不展示百分比（回退为 —），但行本身仍保留", () => {
  const noWindow = context.selectCodexReserveLimits(usageWith([{ id: "gpt-reserve", windows: [] }]));
  assert.equal(noWindow.length, 1);
  assert.equal(noWindow[0].remainingPercent, null);

  const outOfRange = context.selectCodexReserveLimits(usageWith([{ id: "gpt-reserve", windows: [{ remainingPercent: 120, windowSeconds: 604800 }] }]));
  assert.equal(outOfRange[0].remainingPercent, null);

  const nonNumeric = context.selectCodexReserveLimits(usageWith([{ id: "gpt-reserve", windows: [{ remainingPercent: "50", windowSeconds: 604800 }] }]));
  assert.equal(nonNumeric[0].remainingPercent, null);
});

test("多个 gpt-reserve 额度各自成行（取各自主窗口）", () => {
  const limits = context.selectCodexReserveLimits(usageWith([
    { id: "base_model_inference", name: "gpt-reserve", windows: [{ remainingPercent: 30, windowSeconds: 604800 }] },
    { id: "gpt_reserve", name: "Secondary", windows: [{ remainingPercent: 70, windowSeconds: 18000 }] },
  ]));
  assert.equal(limits.length, 2);
  assert.deepEqual(Array.from(limits, limit => limit.remainingPercent), [30, 70]);
  assert.deepEqual(Array.from(limits, limit => limit.name), [null, "Secondary"]);
});

test("用量模块把 reserve 行渲染成与 5h / 周额度一致的结构", () => {
  // 行结构：hud-row hud-usage-row + ChatGPT 图标 + 标签 + hud-balance-value 百分比
  assert.match(source, /const codexReserve = codexUsable \? selectCodexReserveLimits\(codex\.usage\) : \[\];/);
  assert.match(source, /codexReserve\.map\(\(limit, index\) => react\.createElement\("div", \{ className: "hud-row hud-usage-row", key: `\$\{limit\.id\}-\$\{index\}` \},/);
  assert.match(source, /fmtCodexPercent\(limit\.remainingPercent\)/);
  assert.match(source, /limit\.name === null\s*\n\s*\? t\("codexReserve"\)\s*\n\s*: interpolate\(t\("codexReserveNamed"\), \{ name: limit\.name \}\)\),/);
  // 行仅挂在 codex 可用且用量开关打开时（与 5h/周额度同一分支）
  assert.match(source, /codexUsable && showCodex\s*\n\s*\? react\.createElement\(react\.Fragment, null,/);
  // 中英文案齐备
  assert.match(source, /codexReserve: "codex gpt-reserve额度",/);
  assert.match(source, /codexReserveNamed: "codex gpt-reserve额度（\{name\}）",/);
  assert.match(source, /codexReserve: "Codex gpt-reserve quota",/);
  assert.match(source, /codexReserveNamed: "Codex gpt-reserve quota \(\{name\}\)",/);
});
