import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
  MODULE_KEYS, DEFAULT_MODULE_ORDER, defaultModuleOrder, defaultSettings,
  normalizeModuleOrder, sanitizeOrderPatch, normalizeSettings, moduleOrderOf,
  isDefaultSettings, sanitizeModulesPatch, sanitizeUsagePatch,
} from "../lib/settings.js";
import { extractFunction } from "./helpers/client-harness.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** 读取客户端 bundle 源码（用于结构断言）。 */
async function clientSource() {
  return readFile(join(root, "lib/client.js"), "utf8");
}

/** 在独立沙箱里加载客户端那几个纯函数，验证真实行为而非仅匹配源码。 */
function loadClientOrderHelpers() {
  const context = vm.createContext({ Set });
  vm.runInContext(
    `const MODULE_KEYS = ["context", "balance", "git", "subagents", "tasks", "plans", "mcp", "note", "todo"];
     ${extractFunction("defaultModuleOrder")}
     ${extractFunction("normalizeModuleOrder")}`,
    context,
  );
  return context;
}

// —— host 侧纯函数 ——

test("默认顺序覆盖全部模块键，且与客户端渲染表的键集合一致", () => {
  assert.deepEqual([...DEFAULT_MODULE_ORDER].sort(), [...MODULE_KEYS].sort(), "默认顺序必须恰好覆盖全部模块键");
  assert.equal(new Set(DEFAULT_MODULE_ORDER).size, DEFAULT_MODULE_ORDER.length, "默认顺序不得有重复键");
  assert.deepEqual(defaultModuleOrder(), [...DEFAULT_MODULE_ORDER]);
  // 返回的是副本：调用方改动不会污染模块级常量。
  const copy = defaultModuleOrder();
  copy.reverse();
  assert.deepEqual(defaultModuleOrder(), [...DEFAULT_MODULE_ORDER]);
});

test("normalizeModuleOrder 收敛坏输入：非数组/未知键/重复/缺失", () => {
  // 非数组 → 默认顺序
  for (const bad of [null, undefined, 0, "context", {}, true]) {
    assert.deepEqual(normalizeModuleOrder(bad), [...DEFAULT_MODULE_ORDER]);
  }
  // 空数组 → 补齐为默认顺序（不能把面板顺序清空）
  assert.deepEqual(normalizeModuleOrder([]), [...DEFAULT_MODULE_ORDER]);

  // 未知键与非字符串被丢弃，重复只保留首次，末尾补齐缺失键
  const messy = ["git", "nope", "context", "git", 42, null, "todo"];
  const normalized = normalizeModuleOrder(messy);
  assert.deepEqual(normalized.slice(0, 3), ["git", "context", "todo"]);
  assert.equal(new Set(normalized).size, MODULE_KEYS.length, "结果必须是完整排列");
  assert.deepEqual([...normalized].sort(), [...MODULE_KEYS].sort());

  // 完整且合法的顺序原样保留
  const custom = ["todo", "note", "mcp", "plans", "tasks", "subagents", "git", "balance", "context"];
  assert.deepEqual(normalizeModuleOrder(custom), custom);
});

test("sanitizeOrderPatch 拒绝空数组/非数组，合法输入收敛为完整排列", () => {
  assert.equal(sanitizeOrderPatch(null), null);
  assert.equal(sanitizeOrderPatch(undefined), null);
  assert.equal(sanitizeOrderPatch({}), null);
  assert.equal(sanitizeOrderPatch([]), null, "空数组不得清空面板顺序");

  const result = sanitizeOrderPatch(["git", "context"]);
  assert.notEqual(result, null);
  assert.deepEqual(result.patch.slice(0, 2), ["git", "context"]);
  assert.equal(result.patch.length, MODULE_KEYS.length, "补齐为完整排列");
});

test("normalizeSettings 读侧补齐 order，坏数据不会让顺序错乱", () => {
  // 老版本设置没有 order 字段
  const legacy = normalizeSettings({ modules: { git: false }, usage: { codex: false } });
  assert.deepEqual(legacy.order, [...DEFAULT_MODULE_ORDER]);
  assert.equal(legacy.modules.git, false, "既有字段收敛不受影响");
  assert.equal(legacy.usage.codex, false);

  // order 坏数据
  const broken = normalizeSettings({ order: "nope" });
  assert.deepEqual(broken.order, [...DEFAULT_MODULE_ORDER]);
  const partial = normalizeSettings({ order: ["todo", "note"] });
  assert.deepEqual(partial.order.slice(0, 2), ["todo", "note"]);
  assert.equal(partial.order.length, MODULE_KEYS.length);

  // moduleOrderOf 始终返回副本与完整排列
  const copy = moduleOrderOf(partial);
  assert.deepEqual(copy, partial.order);
  copy.pop();
  assert.equal(moduleOrderOf(partial).length, MODULE_KEYS.length);
});

test("defaultSettings 含默认 order，isDefaultSettings 能区分默认与非默认", () => {
  assert.deepEqual(defaultSettings().order, [...DEFAULT_MODULE_ORDER]);
  assert.equal(isDefaultSettings(defaultSettings()), true, "全新设置应被判为默认");
  assert.equal(isDefaultSettings(null), true, "无设置等同于默认");

  // 模块隐藏 → 非默认
  assert.equal(isDefaultSettings({ modules: { ...defaultSettings().modules, git: false } }), false);
  // 用量行隐藏 → 非默认
  assert.equal(isDefaultSettings({ usage: { ...defaultSettings().usage, codex: false } }), false);
  // 仅顺序不同 → 非默认
  const reordered = { ...defaultSettings(), order: [...DEFAULT_MODULE_ORDER].reverse() };
  assert.equal(isDefaultSettings(reordered), false);
  // 顺序残缺时读侧只补齐缺失键，保留已有相对顺序 —— 因此仍可能与默认不同。
  // 残缺输入一律视为「非默认」（宁可让按钮可点，也不让用户卡在改不动的状态）。
  assert.equal(isDefaultSettings({ ...defaultSettings(), order: ["git", "context"] }), false);
  // 而缺失整个字段（老版本设置）应视为默认。
  const noOrder = { ...defaultSettings() };
  delete noOrder.order;
  assert.equal(isDefaultSettings(noOrder), true);
});

test("模块顺序与模块显隐互不影响：改顺序不改可见性，改显隐不改顺序", () => {
  const base = defaultSettings();
  const orderOnly = normalizeSettings({ ...base, order: [...DEFAULT_MODULE_ORDER].reverse() });
  assert.deepEqual(orderOnly.modules, base.modules, "排序不应改变任何模块的可见性");

  const hidden = normalizeSettings({ ...base, modules: { git: false } });
  assert.deepEqual(hidden.order, [...DEFAULT_MODULE_ORDER], "隐藏模块不应改变顺序");
});

// —— 客户端侧纯函数 ——

test("客户端 normalizeModuleOrder 与 host 同规则（同一输入同一结果）", () => {
  const client = loadClientOrderHelpers();
  const inputs = [
    null, undefined, [], "nope", ["git"], ["git", "nope", "git"],
    ["todo", "note", "mcp", "plans", "tasks", "subagents", "git", "balance", "context"],
  ];
  for (const input of inputs) {
    assert.deepEqual(
      JSON.parse(JSON.stringify(client.normalizeModuleOrder(input))),
      normalizeModuleOrder(input),
      `客户端与 host 对 ${JSON.stringify(input)} 的收敛结果必须一致`,
    );
  }
});

// —— 客户端结构与接线 ——

test("设置菜单：拖动排序手柄、点击外部关闭、恢复默认按钮均已接线（v0.16.0）", async () => {
  const source = await clientSource();

  // 拖动排序：复用既有 drag 图标（与「待办」模块同一套图形），仅手柄可拖。
  assert.match(source, /className: "hud-settings-grip"/);
  assert.match(source, /draggable: true/);
  assert.match(source, /react\.createElement\(Icon, \{ name: "drag", size: 14 \}\)/);
  assert.match(source, /const dropModule = \(targetKey\) => \{/);
  assert.match(source, /"data-dragging": dragKey === key/);
  assert.match(source, /"data-over": overKey === key/);

  // 点击外部关闭：捕获阶段监听 + 命中测试，且不吞掉内部点击。
  assert.match(source, /doc\?\.addEventListener\?\.\("pointerdown", onPointerDown, true\)/);
  assert.match(source, /if \(target\.closest\("\.hud-settings-pop"\) !== null\) return;/);
  // 齿轮按钮要被排除，否则 toggle 永远打不开菜单。
  assert.match(source, /btnRef\.current\?\.contains\?\.\(target\) === true\) return;/);
  // 取消/确认仍然各自关闭菜单。
  assert.match(source, /onCancel: \(\) => setMenuOpen\(false\)/);
  assert.match(source, /props\.onSettingsChange\(draft, usageDraft, orderDraft\); setMenuOpen\(false\); \}/);

  // 恢复默认：非默认时激活，且需要点确认才落盘。
  assert.match(source, /"data-kind": "reset"/);
  assert.match(source, /disabled: !dirty/);
  assert.match(source, /const dirty = !isDefaultDraft\(draft, usageDraft, orderDraft, keys, usageKeys\);/);
  assert.match(source, /function isDefaultDraft\(draft, usageDraft, orderDraft, visibleModuleKeys, visibleUsageKeys\) \{/);
});

test("面板按 moduleOrder 渲染：不再写死模块顺序，且不漏渲染", async () => {
  const source = await clientSource();

  // 渲染表 + 顺序映射
  assert.match(source, /const MODULE_RENDERERS = \{/);
  assert.match(source, /const renderOrderedModules = \(\) => normalizeModuleOrder\(moduleOrder\)/);
  assert.match(source, /\.map\(\(key\) => MODULE_RENDERERS\[key\]\?\.\(\) \?\? null\)/);
  assert.match(source, /\.filter\(\(node\) => node !== null\)/);
  assert.match(source, /renderOrderedModules\(\)\)\);/);

  // 渲染表必须覆盖全部模块键，否则排序会让某个模块彻底消失。
  for (const key of MODULE_KEYS) {
    assert.match(source, new RegExp(`\\b${key}: \\(\\) => `), `渲染表缺少 ${key}`);
  }

  // 面板 body 内不得再残留写死顺序的模块调用。
  const bodyStart = source.indexOf('className: "hud-panel-body"');
  assert.ok(bodyStart > 0, "定位不到面板 body");
  const bodySlice = source.slice(bodyStart, bodyStart + 400);
  for (const name of ["ContextModule", "BalanceModule", "GitModule", "SubagentsModule", "TasksModule", "PlansModule", "McpModule", "NoteModule", "TodoModule"]) {
    assert.doesNotMatch(bodySlice, new RegExp(`createElement\\(${name}`), `面板 body 内仍直接写死了 ${name}`);
  }
});

test("排序经由设置链路持久化：hook 保存与读取都带上 order", async () => {
  const source = await clientSource();
  // 读取：初始化快照同时收敛 order
  assert.match(source, /orderRef\.current = normalizeModuleOrder\(body\.order\);/);
  assert.match(source, /setOrder\(normalizeModuleOrder\(body\.order\)\);/);
  // 保存：请求体带 order，且未传时沿用当前顺序
  assert.match(source, /call\("settings", \{ modules: nextModules, usage: nextUsage, order: nextOrder \}\)/);
  assert.match(source, /const nextOrder = orderPatch === undefined \? \(orderRef\.current \?\? defaultModuleOrder\(\)\) : normalizeModuleOrder\(orderPatch\);/);
  // 顺序是全局设置（不按会话），因此由面板层统一传给会话模块与设置菜单。
  assert.match(source, /order: moduleOrder,/);
  assert.match(source, /order: props\.order,/);
});

test("点击外部关闭：命中判定与监听器注册方式（不吞菜单内部点击）", async () => {
  const source = await clientSource();

  // 监听器必须在捕获阶段注册、卸载时移除。
  assert.match(source, /doc\?\.addEventListener\?\.\("pointerdown", onPointerDown, true\)/);
  assert.match(source, /doc\?\.removeEventListener\?\.\("pointerdown", onPointerDown, true\)/);

  // 判定顺序：先放行菜单内部，再放行齿轮按钮，其余一律关闭。
  const start = source.indexOf("const onPointerDown = (event) => {");
  assert.ok(start > 0, "定位不到外部点击处理函数");
  const closeIdx = source.indexOf("setMenuOpen(false);", start);
  const popIdx = source.indexOf('target.closest(".hud-settings-pop")', start);
  const btnIdx = source.indexOf("btnRef.current?.contains?.(target)", start);
  assert.ok(popIdx > 0 && btnIdx > 0, "命中判定缺少菜单/按钮排除");
  assert.ok(popIdx < closeIdx, "必须先判定菜单内部，再考虑关闭");
  assert.ok(btnIdx < closeIdx, "必须在关闭前排除齿轮按钮（否则菜单永远打不开）");
  // 只关闭、不阻止事件传播：取消/确认等按钮的 onClick 仍要照常执行。
  assert.doesNotMatch(source.slice(start, closeIdx + 40), /stopPropagation|preventDefault/);

  // 拖动排序走 HTML5 drag 事件，不产生 pointerdown，因此不会误关闭。
  assert.match(source, /onDragStart: \(event\) => \{/);
  assert.match(source, /event\.dataTransfer\?\.setData\?\.\("text\/plain", key\);/);
});
