// dsh-awesome-hud — v0.21.2：模块置顶（任一模块，同时只允许一个）
//
// 覆盖点：
//   1. 设置模型：顶层 pinned 默认未置顶、收敛/白名单、isDefaultSettings 口径；
//   2. 旧字段迁移：context.pinned=true → 上下文置顶，保存过一次后不再复活；
//   3. host schema：pinned 是字符串、context 段已无 pinned；
//   4. 客户端镜像：normalizePinned / pinnedOfSettings 与 host 同规则（两份实现逐项对比）；
//   5. 纯函数：pinButtonState 四态、moveKeyToFront / restoreKeyAt；
//   6. 设置弹窗与面板接线：置顶按钮、置顶卡锁定首位、滚动区去重、固定区限高；
//   7. 官方图钉图标（含内置资产兜底）；
//   8. 中英文案齐备，旧「上下文模块位置固定」键已删除。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import vm from "node:vm";
import {
  MODULE_KEYS, PINNED_NONE, defaultModules, defaultSettings, normalizeSettings, isDefaultSettings,
  normalizePinned, pinnedOfSettings, sanitizePinnedPatch, pinnedOf,
  defaultContextSettings, normalizeContextSettings, sanitizeContextPatch, contextSettingsOf,
} from "../lib/settings.js";
import { clientSource, extractFunction, hudClient, moduleOf, nodes, settled } from "./helpers/client-harness.mjs";
import { apply } from "../lib/index.js";

const hostSource = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");

/** 在独立 vm 上下文里跑客户端那两个「置顶键收敛」纯函数（真实源码）。 */
function loadClientPinHelpers() {
  const context = vm.createContext({ MODULE_KEYS: [...MODULE_KEYS] });
  vm.runInContext(`${extractFunction("normalizePinned")}\n${extractFunction("pinnedOfSettings")}`, context);
  return {
    normalizePinned: (value) => vm.runInContext(`this.out = normalizePinned(${JSON.stringify(value)}); this.out`, context),
    pinnedOfSettings: (raw) => vm.runInContext(`this.out = pinnedOfSettings(${JSON.stringify(raw ?? null)}); this.out`, context),
  };
}

/** 跨 realm 的对象/数组转成本域普通值，便于 deepEqual 比较。 */
const plain = (value) => JSON.parse(JSON.stringify(value));

/** 在独立 vm 上下文里跑设置弹窗的三个纯函数（真实源码）。 */
function loadDialogPinHelpers() {
  const context = vm.createContext({ MODULE_KEYS: [...MODULE_KEYS] });
  vm.runInContext(
    `${extractFunction("defaultModuleOrder")}\n${extractFunction("normalizeModuleOrder")}\n${extractFunction("pinButtonState")}\n${extractFunction("moveKeyToFront")}\n${extractFunction("restoreKeyAt")}`,
    context,
  );
  return {
    pinButtonState: (pinned, key, locked, enabled = true) => plain(vm.runInContext(
      `this.out = pinButtonState(${JSON.stringify(pinned)}, ${JSON.stringify(key)}, ${locked === true}, ${enabled !== false}); this.out`,
      context,
    )),
    moveKeyToFront: (order, key) => plain(vm.runInContext(
      `this.out = moveKeyToFront(${JSON.stringify(order)}, ${JSON.stringify(key)}); this.out`,
      context,
    )),
    restoreKeyAt: (order, key, index) => plain(vm.runInContext(
      `this.out = restoreKeyAt(${JSON.stringify(order)}, ${JSON.stringify(key)}, ${JSON.stringify(index)}); this.out`,
      context,
    )),
  };
}

const workingWorkspace = () => ({
  workspaceId: "w1",
  path: "/work/session",
  title: "Session",
  updatedAt: 2,
  sessionIds: ["sess"],
});

// —— 1. 设置模型 ——

test("设置模型：pinned 默认未置顶，收敛/白名单/默认判定一并生效", () => {
  assert.equal(PINNED_NONE, "");
  assert.equal(defaultSettings().pinned, "");
  // 只接受 MODULE_KEYS 里的键；其余（未知键、布尔、数字、对象）一律视为未置顶
  for (const key of MODULE_KEYS) assert.equal(normalizePinned(key), key);
  for (const bad of ["nope", "", null, undefined, true, 1, {}, []]) assert.equal(normalizePinned(bad), "");
  assert.equal(normalizeSettings({}).pinned, "");
  assert.equal(normalizeSettings({ pinned: "git" }).pinned, "git");
  assert.equal(normalizeSettings({ pinned: "nope" }).pinned, "");
  assert.equal(pinnedOf({ pinned: "todo" }), "todo");
  assert.equal(pinnedOf(null), "");
  // 写侧白名单：接受 "" 与合法键，拒绝其它类型与未知键
  assert.deepEqual(sanitizePinnedPatch(""), { patch: "", changed: false });
  assert.deepEqual(sanitizePinnedPatch("mcp"), { patch: "mcp", changed: false });
  assert.equal(sanitizePinnedPatch("nope"), null);
  assert.equal(sanitizePinnedPatch(1), null);
  assert.equal(sanitizePinnedPatch(null), null);
  assert.equal(sanitizePinnedPatch(undefined), null);
  // 「恢复默认」把置顶计入比较
  assert.equal(isDefaultSettings(defaultSettings()), true);
  assert.equal(isDefaultSettings({ ...defaultSettings(), pinned: "context" }), false);
});

test("旧字段迁移：context.pinned=true → 上下文置顶，显式 pinned 优先，保存过后不复活", () => {
  // 旧 profile：只有 context.pinned（布尔）
  assert.equal(normalizeSettings({ context: { pinned: true } }).pinned, "context");
  assert.equal(pinnedOfSettings({ context: { pinned: true } }), "context");
  // 旧字段为 false → 未置顶
  assert.equal(normalizeSettings({ context: { pinned: false } }).pinned, "");
  // 显式 pinned 优先于旧字段（用户在新版里取消置顶后 context 段已无该字段）
  assert.equal(normalizeSettings({ pinned: "git", context: { pinned: true } }).pinned, "git");
  // 显式置空（用户取消置顶）且旧字段已不存在 → 未置顶
  assert.equal(normalizeSettings({ pinned: "", context: { barStyle: "default" } }).pinned, "");
  // 坏数据不抛错
  assert.equal(normalizeSettings({ pinned: 7, context: "x" }).pinned, "");
});

test("上下文设置段不再包含 pinned，且旧 patch 被忽略", () => {
  assert.deepEqual(defaultContextSettings(), { barStyle: "default", showStats: true, showUsage: true });
  assert.deepEqual(normalizeContextSettings({ barStyle: "segmented", pinned: true }), { barStyle: "segmented", showStats: true, showUsage: true });
  assert.deepEqual(contextSettingsOf({ context: { barStyle: "segmented", pinned: true } }), { barStyle: "segmented", showStats: true, showUsage: true });
  // 只剩旧的 pinned 字段 → 没有可写的白名单字段，整体视为无效 patch
  assert.equal(sanitizeContextPatch({ pinned: true }), null);
});

test("host schema：顶层 pinned 是字符串，context 段已移除 pinned", () => {
  assert.match(hostSource, /pinned: z\.string\(\)\.default\(""\)\.volatile\(\),/);
  assert.doesNotMatch(hostSource, /context: z\.object\(\{[\s\S]{0,200}pinned: z\.boolean\(\)/);
  // settings 路由：GET 回传 pinned、POST 解析并合并
  assert.match(hostSource, /const pinnedResult = sanitizePinnedPatch\(payload\?\.pinned\);/);
  assert.match(hostSource, /const mergedPinned = pinnedResult === null \? pinnedOf\(current\) : normalizePinned\(pinnedResult\.patch\);/);
  assert.match(hostSource, /pinned: normalizePinned\(mergedPinned\),/);
});

// —— 2. 客户端镜像与纯函数 ——

test("客户端镜像：normalizePinned / pinnedOfSettings 与 host 同规则", () => {
  const client = loadClientPinHelpers();
  const cases = [
    undefined, null, "", "context", "git", "todo", "nope", 1, true, {},
  ];
  for (const value of cases) {
    assert.equal(client.normalizePinned(value), normalizePinned(value), `normalizePinned(${String(value)})`);
  }
  const raws = [
    null, undefined, {}, { pinned: "git" }, { pinned: "nope" }, { pinned: "" },
    { context: { pinned: true } }, { context: { pinned: false } },
    { pinned: "git", context: { pinned: true } }, { pinned: "", context: { barStyle: "default" } },
  ];
  for (const raw of raws) {
    assert.equal(client.pinnedOfSettings(raw), pinnedOfSettings(raw), `pinnedOfSettings(${JSON.stringify(raw)})`);
  }
});

test("pinButtonState：已置顶可取消、其它置顶时置灰、本页锁定置灰", () => {
  const helper = loadDialogPinHelpers();
  // 没有置顶：可点
  assert.deepEqual(helper.pinButtonState("", "context", false), { allowed: true, reason: null });
  // 自己已置顶：可点（用于取消），即使本页锁定也要能取消
  assert.deepEqual(helper.pinButtonState("context", "context", false), { allowed: true, reason: null });
  assert.deepEqual(helper.pinButtonState("context", "context", true), { allowed: true, reason: null });
  // 别的模块已置顶：置灰并给 occupied
  assert.deepEqual(helper.pinButtonState("context", "git", false), { allowed: false, reason: "occupied" });
  // v0.21.2：模块已关闭（复选框未勾选）时不能置顶；已置顶的仍可取消。
  assert.deepEqual(helper.pinButtonState("", "context", false, false), { allowed: false, reason: "disabled" });
  assert.deepEqual(helper.pinButtonState("context", "context", false, false), { allowed: true, reason: null });
  // 已有其它模块置顶时优先给「先取消置顶」（唯一可解的动作）。
  assert.deepEqual(helper.pinButtonState("context", "git", false, false), { allowed: false, reason: "occupied" });
  // 本页不展示的模块：置灰并给 locked
  assert.deepEqual(helper.pinButtonState("", "context", true), { allowed: false, reason: "locked" });
});

test("moveKeyToFront / restoreKeyAt：置顶到首位、取消时插回原位、越界钳制", () => {
  const helper = loadDialogPinHelpers();
  const order = [...MODULE_KEYS];
  // 置顶：把中间的键搬到首位，结果仍是完整排列且不改入参
  const moved = helper.moveKeyToFront(order, "git");
  assert.equal(moved[0], "git");
  assert.equal(moved.length, MODULE_KEYS.length);
  assert.deepEqual(order, [...MODULE_KEYS], "入参不能被改写");
  assert.equal(new Set(moved).size, MODULE_KEYS.length);
  // 取消置顶：插回置顶前的下标
  const restored = helper.restoreKeyAt(moved, "git", order.indexOf("git"));
  assert.deepEqual(restored, [...MODULE_KEYS]);
  // 下标越界时钳制到合法范围
  const clampedHigh = helper.restoreKeyAt(moved, "git", 999);
  assert.equal(clampedHigh[clampedHigh.length - 1], "git");
  const clampedLow = helper.restoreKeyAt(moved, "git", -5);
  assert.equal(clampedLow[0], "git");
  // 未知键原样返回归一化结果
  assert.deepEqual(helper.moveKeyToFront(order, "nope"), [...MODULE_KEYS]);
});

// —— 3. 设置弹窗 / 面板接线 ——

test("设置弹窗接线：置顶按钮、置顶卡锁定首位、隐藏自动取消、恢复默认清空", () => {
  // 置顶按钮排在「名称」与「复选框」之间，且走官方图钉图标
  const labelIndex = clientSource.indexOf('className: "hud-settings-card-label"');
  const pinIndex = clientSource.indexOf('className: "hud-settings-pin"');
  const inputIndex = clientSource.indexOf('id: checkboxId,', pinIndex);
  assert.ok(labelIndex > 0 && pinIndex > labelIndex && inputIndex > pinIndex, "置顶按钮必须夹在名称与复选框之间");
  assert.match(clientSource, /const pinIconName = pinned \? "IconPinFillRegular" : "IconPinOutlineRegular";/);
  assert.match(clientSource, /officialIcon\(pinIconName\) === null/);
  // v0.21.2：置顶态的颜色由按钮 CSS 决定，图标只继承 currentColor（图标默认色不再覆盖成黑色）。
  assert.match(clientSource, /\? react\.createElement\(Icon, \{ name: "pin", size: 14, color: "inherit" \}\)/);
  assert.match(clientSource, /: react\.createElement\(OfficialIcon, \{ name: pinIconName, size: 14, color: "inherit" \}\)/);
  // 置顶态用主文本色（黑/白随主题），不再染品牌蓝（用户反馈：取消置顶按钮应为黑色）。
  assert.match(clientSource, /\.hud-settings-pin\[data-pinned=true\]\{color:var\(--dsw-alias-label-primary\)/);
  assert.doesNotMatch(clientSource, /\.hud-settings-pin\[data-pinned=true\]\{color:var\(--dsw-alias-state-business-primary\)/);
  assert.doesNotMatch(clientSource, /pinIconColor/);
  // 置顶卡不能拖动（锁定首位）
  assert.match(clientSource, /draggable: !pinned,/);
  assert.match(clientSource, /onDragStart: pinned \? undefined : \(event\) => startDrag\(event, key\),/);
  // 置顶时记录基线下标并移到首位
  assert.match(clientSource, /pinBaselineRef\.current = \{ key, index: index < 0 \? 0 : index \};/);
  assert.match(clientSource, /setOrderDraft\(\(prev\) => moveKeyToFront\(prev, key\)\);/);
  // 取消置顶：有基线则插回原位，无基线（已保存过）留在首位
  assert.match(clientSource, /setOrderDraft\(\(prev\) => restoreKeyAt\(prev, key, baseline\.index\)\);/);
  // 取消勾选被置顶的模块 → 自动取消置顶
  assert.match(clientSource, /if \(!next && pinnedDraft === key\) \{\n\t+setPinnedDraft\(""\);\n\t+pinBaselineRef\.current = null;/);
  // 恢复默认（左栏 / 全部）清空置顶并复位顺序
  const resetAll = clientSource.indexOf("const resetAllSettings = () => {");
  const resetModules = clientSource.indexOf("const resetModulesSettings = () => {");
  assert.ok(resetAll > 0 && resetModules > resetAll);
  assert.match(clientSource.slice(resetAll, resetModules), /setPinnedDraft\(""\);/);
  assert.match(clientSource.slice(resetModules, resetModules + 400), /setPinnedDraft\(""\);/);
  // 确认时把置顶键作为第 8 个草稿一起提交
  // v0.21.2 修复（issue：置顶恒在首位）：落盘前置顶键提升到顺序最前（savedOrder）。
  assert.match(clientSource, /const savedOrder = pinnedKey !== "" \? \[pinnedKey, \.\.\.orderDraft\.filter\(\(key\) => key !== pinnedKey\)\] : orderDraft;/);
  assert.match(clientSource, /props\.onConfirm\(draft, usageDraft, savedOrder, contextDraft, panelDraft, noteDraft, gitDraft, pinnedKey\);/);
});

test("面板接线：置顶模块渲染在固定区、滚动区去重、隐藏时不渲染固定区", () => {
  assert.match(clientSource, /const pinnedKey = normalizePinned\(pinnedModule\);/);
  assert.match(clientSource, /const pinnedActive = pinnedKey !== "" && activeModules\[pinnedKey\] !== false;/);
  assert.match(clientSource, /const pinnedContent = pinnedActive \? \(MODULE_RENDERERS\[pinnedKey\]\?\.\(\) \?\? null\) : null;/);
  // 滚动区跳过置顶键
  assert.match(clientSource, /\.filter\(\(key\) => key !== pinnedKey\)/);
  // 固定区挂在会话模块之后、滚动容器之前，且带 ref（标题吸附要观察它）
  const sessionIndex = clientSource.indexOf("react.createElement(SessionModule, {");
  const pinZoneIndex = clientSource.indexOf('className: "hud-panel-pin", ref: pinRef }');
  const bodyIndex = clientSource.indexOf('className: "hud-panel-body", ref: bodyRef');
  assert.ok(sessionIndex > 0 && pinZoneIndex > sessionIndex && bodyIndex > pinZoneIndex, "固定区必须夹在会话模块与滚动容器之间");
  // 无内容时不渲染空固定区（限高交给 CSS 的 40vh）
  assert.match(clientSource, /pinnedContent === null \? null : react\.createElement\("div", \{ className: "hud-panel-pin", ref: pinRef \}, pinnedContent\),/);
});

test("面板：未置顶时没有固定区，上下文仍在滚动区首位", async () => {
  const client = hudClient({
    state: { current: "sess", byId: { sess: { cwd: "/work/session", updatedAt: 2, displayTitle: "Session A" } } },
    current: "sess",
    workspaces: [workingWorkspace()],
  });
  const panel = client.panel();
  assert.equal(nodes(panel).some((node) => node.props?.className === "hud-panel-pin"), false);
  const body = nodes(panel).find((node) => node.props?.className === "hud-panel-body");
  assert.ok(body !== undefined, "滚动容器必须存在");
  const firstModule = nodes(body).slice(1)[0];
  assert.equal(firstModule?.type?.name, "ContextModule", "默认顺序下上下文仍是滚动区第一项");
});

test("面板：置顶上下文时移入固定区，滚动区不再重复渲染", async () => {
  const settingsBody = {
    ok: true,
    modules: { ...defaultModules() },
    order: [...MODULE_KEYS],
    context: defaultContextSettings(),
    pinned: "context",
  };
  const client = hudClient({
    state: { current: "sess", byId: { sess: { cwd: "/work/session", updatedAt: 2, displayTitle: "Session A" } } },
    current: "sess",
    workspaces: [workingWorkspace()],
    // 面板设置与设置读取在同一轮 effect 里发起，这里放行这两个 effect。
    effectFilter: (label) => /styles|dictionaries|panel prefs/.test(label ?? ""),
    respond: (call) => (call.url.endsWith("/settings") ? settingsBody : { ok: true, servers: [], total: 0, enabled: 0, isRepo: true }),
  });
  await settled();
  await settled();
  const panel = client.panel();
  const pinZone = nodes(panel).find((node) => node.props?.className === "hud-panel-pin");
  assert.ok(pinZone !== undefined, "置顶后必须出现固定区");
  assert.equal(nodes(pinZone).slice(1)[0]?.type?.name, "ContextModule", "固定区里是置顶的上下文模块");
  const body = nodes(panel).find((node) => node.props?.className === "hud-panel-body");
  assert.equal(nodes(body).some((node) => node.type?.name === "ContextModule"), false, "滚动区不得重复渲染上下文");
});

test("样式：固定区限高、内部滚动、标题同样吸附", () => {
  // v0.21.2：置顶区限高 40vh（纯 CSS，随窗口缩放自动生效，不依赖任何实测）
  assert.match(clientSource, /\.hud-panel-pin\{flex:none;min-height:0;max-height:40vh;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;border-top:1px solid color-mix\(in srgb,var\(--dsw-alias-label-primary\) 9%,transparent\)\}/);
  // 不再写内联 max-height（避免与 CSS 打架），也不再需要尺寸实测
  assert.doesNotMatch(clientSource, /pinMaxHeight/);
  assert.doesNotMatch(clientSource, /panelMetrics/);
  assert.match(clientSource, /\.hud-panel-pin::-webkit-scrollbar\{width:0;height:0;display:none\}/);
  assert.doesNotMatch(clientSource, /\.hud-panel-pin\{flex:0 1 auto/);
  // 标题吸附：滚动区与固定区共用同一套 sticky 规则
  assert.match(clientSource, /\.hud-panel-body>\.hud-section>\.hud-module-head,\.hud-panel-pin>\.hud-section>\.hud-module-head\{position:sticky;top:0;z-index:1\}/);
  assert.match(clientSource, /\.hud-panel-pin>\.hud-section>\.hud-module-head\[data-stuck=true\]\{background:var\(--hud-surface-bg\)\}/);
  assert.match(clientSource, /\.hud-panel-pin>\.hud-section:not\(:first-child\)>\.hud-module-head\[data-stuck=true\]::before\{/);
  // 吸附检测同时观察两个滚动容器
  assert.match(clientSource, /const containers = \[bodyRef\.current, pinRef\.current\]\.filter/);
  assert.match(clientSource, /for \(const body of containers\) body\.addEventListener\("scroll", schedule, \{ passive: true \}\);/);
  assert.match(clientSource, /for \(const body of containers\) observer\?\.observe\?\.\(body\);/);
});

// —— 4. 文案与资产 ——

test("中英字典补齐置顶文案，旧「上下文模块位置固定」键已删除", () => {
  const client = hudClient();
  const [dicts] = client.dictionaries;
  assert.ok(dicts !== undefined, "字典必须已注册");
  for (const ns of ["zh", "en"]) {
    for (const key of ["settingsPinModule", "settingsUnpinModule", "settingsPinOccupied", "settingsPinLocked", "settingsDragPinned"]) {
      assert.equal(typeof dicts[ns][key], "string", `${ns}.${key} 必须是字符串`);
      assert.ok(dicts[ns][key].length > 0, `${ns}.${key} 不能为空`);
    }
    for (const removed of ["settingsContextPin", "settingsContextPinHint", "settingsContextPinOrder", "settingsContextPinHidden"]) {
      assert.equal(dicts[ns][removed], undefined, `${ns}.${removed} 应已删除`);
    }
  }
  assert.equal(dicts.zh.settingsPinModule, "置顶该模块");
  assert.equal(dicts.zh.settingsUnpinModule, "取消置顶该模块");
  assert.equal(dicts.en.settingsPinModule, "Pin this module");
  assert.equal(dicts.en.settingsUnpinModule, "Unpin this module");
});

test("图钉图标：内联优先、不再占资产路由，且官方图标缺失时回退到它", () => {
  // v0.21.2：图钉改为 INLINE_ICONS 里的一份内联 SVG（与 gauge / database 同一做法），
  // 因此 assets/icons/pin.svg 与宿主白名单条目都已移除。
  assert.match(clientSource, /const INLINE_ICONS = Object\.freeze\(\{\n\t+\/\/ v0\.21\.2：设置左栏的「置顶」图钉[\s\S]{0,80}?pin: `<svg[^`]*viewBox="0 0 24 24"[^`]*fill="currentColor"[^`]*<\/svg>`/);
  assert.doesNotMatch(clientSource, /FALLBACK_ICONS = Object\.freeze\(\{[\s\S]{0,600}?\n\t+pin:/);
  assert.doesNotMatch(hostSource, /"pin\.svg": "svg",/, "宿主资产白名单不再包含 pin.svg");
  assert.throws(() => assetFileFor("pin.svg"), "已删除的资产不得再被路由放行");
  // 官方 pin 图标缺失（旧版 primitives）时回退到内联图标，不能出现空按钮。
  assert.match(clientSource, /officialIcon\(pinIconName\) === null\n\t+\? react\.createElement\(Icon, \{ name: "pin", size: 14, color: "inherit" \}\)/);
});

test("重启后置顶仍在：host 读侧快照带出 pinned（回归 v0.21.2 丢失问题）", async () => {
  // 真实 apply + 假 settings 服务：config 模拟「DSH 从 cordis.patch.yml 读回来的持久化值」
  const routes = [];
  const updates = [];
  const configValue = (value) => ({ get: () => value });
  const config = {
    modules: configValue({ context: true, git: true }),
    usage: configValue({ deepseek: true, opencode: true, codex: true, folded: "none" }),
    context: configValue({ barStyle: "default", showStats: true, showUsage: true }),
    order: configValue([...MODULE_KEYS]),
    // 落盘值：上下文置顶（旧字段 context.pinned 已不存在）
    pinned: configValue("context"),
    panel: configValue({ style: "card", side: "right", newSessionOpen: false, chatOpen: true }),
    commitPrompt: configValue(""),
    note: configValue({ maxCount: 5, popupEdit: false }),
    git: configValue({ view: "list" }),
  };
  const ctx = {
    get: (name) => (name === "settings"
      ? {
        describe: () => [{ ns: "awesome-hud", revision: 3 }],
        writable: true,
        update: async (id, patch) => { updates.push({ id, patch }); },
      }
      : undefined),
    effect: (fn) => fn(),
    fiber: { entry: { options: { id: "awesome-hud" } } },
    webServer: { register: (route) => { routes.push(route); return () => {}; } },
  };
  apply(ctx, config);
  const api = routes.find((route) => route.path === "/awesome-hud/api").handler;
  const request = async (method, body) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body ?? {}))]);
    Object.assign(req, { method, url: "/awesome-hud/api/settings", headers: { host: "127.0.0.1:1234" } });
    let status;
    let result;
    await api(req, { writeHead: (code) => { status = code; }, end: (data) => { result = JSON.parse(data); } });
    return { status, ...result };
  };
  // 读：必须带出 pinned=context（否则重启后面板看不到置顶）
  const read = await request("GET");
  assert.equal(read.status, 200, JSON.stringify(read));
  assert.equal(read.pinned, "context", "GET 必须回传已持久化的置顶键");
  // 写：清空置顶后再次读取应回空字符串，且 patch 里带 pinned
  const written = await request("POST", { pinned: "" });
  assert.equal(written.status, 200, JSON.stringify(written));
  assert.equal(written.pinned, "");
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, "awesome-hud");
  assert.equal(updates[0].patch.pinned, "", "写入 patch 必须带 pinned");
  // 旧字段迁移：config 里只有 context.pinned=true 时仍读成「上下文置顶」
  const legacyRoutes = [];
  const legacyCtx = { ...ctx, webServer: { register: (route) => { legacyRoutes.push(route); return () => {}; } } };
  apply(legacyCtx, { ...config, pinned: configValue(""), context: configValue({ barStyle: "default", showStats: true, showUsage: true, pinned: true }) });
  const legacyApi = legacyRoutes.find((route) => route.path === "/awesome-hud/api").handler;
  const legacyReq = Readable.from([Buffer.from("{}")]);
  Object.assign(legacyReq, { method: "GET", url: "/awesome-hud/api/settings", headers: { host: "127.0.0.1:1234" } });
  let legacyResult;
  await legacyApi(legacyReq, { writeHead: () => {}, end: (data) => { legacyResult = JSON.parse(data); } });
  assert.equal(legacyResult.pinned, "context", "旧 context.pinned 仍应迁移成上下文置顶");
});
