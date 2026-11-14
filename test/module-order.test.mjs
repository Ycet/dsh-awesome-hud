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
    `const MODULE_KEYS = ["context", "balance", "outputs", "git", "subagents", "tasks", "plans", "mcp", "note", "todo"];
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
  // v0.19.2：默认位置在 git 之上（面板里先看产物、再看 git 变更）。
  assert.equal(DEFAULT_MODULE_ORDER.indexOf("outputs"), DEFAULT_MODULE_ORDER.indexOf("git") - 1, "outputs 默认排在 git 之前");
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
  // v0.19.1：补齐后按锚点落位，新增的 outputs 排在 git 之前
  assert.deepEqual(normalized.slice(0, 4), ["outputs", "git", "context", "todo"]);
  assert.equal(new Set(normalized).size, MODULE_KEYS.length, "结果必须是完整排列");
  assert.deepEqual([...normalized].sort(), [...MODULE_KEYS].sort());

  // 完整且合法的顺序原样保留
  const custom = ["todo", "note", "mcp", "plans", "tasks", "subagents", "git", "outputs", "balance", "context"];
  assert.deepEqual(normalizeModuleOrder(custom), custom);
});

test("sanitizeOrderPatch 拒绝空数组/非数组，合法输入收敛为完整排列", () => {
  assert.equal(sanitizeOrderPatch(null), null);
  assert.equal(sanitizeOrderPatch(undefined), null);
  assert.equal(sanitizeOrderPatch({}), null);
  assert.equal(sanitizeOrderPatch([]), null, "空数组不得清空面板顺序");

  const result = sanitizeOrderPatch(["git", "context"]);
  assert.notEqual(result, null);
  assert.deepEqual(result.patch.slice(0, 2), ["outputs", "git"], "缺失的 outputs 按锚点落在 git 之前");
  assert.equal(result.patch.length, MODULE_KEYS.length, "补齐为完整排列");
});

test("v0.19.2：用户调整后的模块位置不会被锚点覆盖", () => {
  // 用户把 outputs 拖到首位 / 中间 / 末尾：写侧、读侧都必须原样保留，
  // 否则每次「确认」都会把它拉回 git 下方，看起来像排序没生效（本次修复的缺陷）。
  const movedTop = ["outputs", "context", "balance", "git", "subagents", "tasks", "plans", "mcp", "note", "todo"];
  const movedMid = ["context", "balance", "git", "subagents", "outputs", "tasks", "plans", "mcp", "note", "todo"];
  const movedTail = ["context", "balance", "git", "subagents", "tasks", "plans", "mcp", "note", "todo", "outputs"];
  for (const moved of [movedTop, movedMid, movedTail]) {
    assert.deepEqual(normalizeModuleOrder(moved), moved, `已保存的顺序必须原样保留：${moved.join(",")}`);
    assert.deepEqual(sanitizeOrderPatch(moved).patch, moved, "写侧不得改写用户调整后的位置");
    assert.deepEqual(normalizeSettings({ order: moved }).order, moved, "读侧不得改写用户调整后的位置");
    // 幂等：多次读写的收敛结果不变，位置不会来回漂移。
    assert.deepEqual(normalizeModuleOrder(normalizeModuleOrder(moved)), moved);
  }

  // 锚点只服务于旧配置迁移：保存的顺序里没有 outputs 时仍插到 git 之前。
  const legacy = ["context", "balance", "git", "subagents", "tasks", "plans", "mcp", "note", "todo"];
  assert.deepEqual(normalizeModuleOrder(legacy).slice(0, 4), ["context", "balance", "outputs", "git"]);

  // 客户端同规则：不把用户拖走的 outputs 拉回来。
  const client = loadClientOrderHelpers();
  for (const order of [movedTop, movedMid, movedTail, legacy]) {
    assert.deepEqual(
      JSON.parse(JSON.stringify(client.normalizeModuleOrder(order))),
      normalizeModuleOrder(order),
      `客户端与 host 结果必须一致：${order.join(",")}`,
    );
  }
  assert.deepEqual(JSON.parse(JSON.stringify(client.normalizeModuleOrder(movedTop))), movedTop);
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

test("拖动排序预览：按原始槽位定位落点，插入顺序可上下移动", () => {
  const context = vm.createContext({ Set });
  vm.runInContext(
    `${extractFunction("moduleDropIndex")}\n${extractFunction("previewModuleOrder")}\n${extractFunction("mergePreviewOrder")}\nthis.moduleDropIndex = moduleDropIndex; this.previewModuleOrder = previewModuleOrder; this.mergePreviewOrder = mergePreviewOrder;`,
    context,
  );
  const { moduleDropIndex, previewModuleOrder, mergePreviewOrder } = context;
  const tops = [0, 42, 84, 126];
  const step = 42;
  // 指针在槽位上半区 → 该槽；下半区 → 下一槽；越界落到最后。
  assert.equal(moduleDropIndex(tops, step, -5), 0);
  assert.equal(moduleDropIndex(tops, step, 10), 0);
  assert.equal(moduleDropIndex(tops, step, 30), 1);
  assert.equal(moduleDropIndex(tops, step, 60), 1);
  assert.equal(moduleDropIndex(tops, step, 84), 2);
  assert.equal(moduleDropIndex(tops, step, 110), 3);
  assert.equal(moduleDropIndex(tops, step, 999), 3);
  assert.equal(moduleDropIndex([], step, 0), -1);

  // 预览顺序：目标下标按原始槽位计，先移除再插入。
  assert.deepEqual(previewModuleOrder(["a", "b", "c", "d"], "a", 2), ["b", "c", "a", "d"]);
  assert.deepEqual(previewModuleOrder(["a", "b", "c", "d"], "d", 1), ["a", "d", "b", "c"]);
  assert.deepEqual(previewModuleOrder(["a", "b", "c", "d"], "b", 0), ["b", "a", "c", "d"]);
  assert.deepEqual(previewModuleOrder(["a", "b", "c", "d"], "b", 99), ["a", "c", "d", "b"]);
  assert.deepEqual(previewModuleOrder(["a", "b", "c"], "x", 1), ["a", "b", "c"]);
  // 预览只含可见键，写回完整顺序时隐藏键保持原位置。
  assert.deepEqual(mergePreviewOrder(["a", "balance", "b", "c"], ["a", "b", "c"], ["c", "a", "b"]), ["c", "balance", "a", "b"]);
});

// —— 客户端结构与接线 ——

test("HUD 设置弹窗：模块卡片列表、拖动排序、恢复默认均已接线（v0.17.0）", async () => {
  const source = await clientSource();

  // 齿轮按钮改为打开弹窗（不再打开菜单）。
  assert.match(source, /function SettingsDialog\(props\) \{/);
  assert.match(source, /const \[settingsOpen, setSettingsOpen\] = react\.useState\(false\);/);
  assert.match(source, /"aria-haspopup": "dialog",/);
  assert.match(source, /"aria-expanded": settingsOpen,/);
  assert.match(source, /onClick: \(\) => setSettingsOpen\(true\),/);
  assert.match(source, /className: "hud-modal hud-settings-modal",/);
  assert.match(source, /role: "dialog",/);
  assert.match(source, /"aria-modal": "true",/);
  // v0.18.5：标题行改为两个标签，弹窗可达名改由 aria-label 提供。
  assert.match(source, /"aria-label": t\("settingsTitle"\),/);
  assert.match(source, /return react_dom\.createPortal\(dialog, document\.body\);/);

  // 每个模块一张卡片：单列纵向列表 + 独立卡片类 + 关闭态标记。
  assert.match(source, /className: "hud-settings-list",/);
  assert.match(source, /orderedKeys\.map\(\(key, index\) => \{/);
  assert.match(source, /className: "hud-settings-card",/);
  assert.match(source, /"data-off": draft\[key\] === false,/);
  assert.match(source, /"data-dragging": dragPreview !== null && dragPreview\.key === key,/);
  // v0.18.2：左栏列表更紧凑（9 张卡片要在不滚动的前提下全部露出）。
  assert.match(source, /\.hud-settings-list\{display:flex;flex-direction:column;gap:6px;min-height:0;flex:none\}/);
  assert.doesNotMatch(source, /hud-settings-order/);
  assert.match(source, /className: "hud-settings-card-name" }, MODULE_LABELS\[key\]\(\)\)/);
  // v0.18.2：改为左右分栏——左栏模块清单，右栏三个卡片式设置分区。
  assert.match(source, /className: "hud-settings-panes" },/);
  assert.match(source, /className: "hud-settings-pane hud-settings-pane-modules" },/);
  assert.match(source, /className: "hud-settings-pane hud-settings-pane-detail" },/);
  assert.match(source, /\.hud-settings-pane-modules\{flex:none;width:240px;/);
  assert.match(source, /\.hud-settings-pane-modules\{[^}]*overflow:hidden/);
  assert.match(source, /\.hud-settings-pane-detail\{[^}]*overflow-y:auto/);
  // 右栏每个模块一张卡片（标题 + 若干设置行）。
  // v0.20.0：新增「便笺」设置卡片 → 4 段。
  assert.equal((source.match(/className: "hud-settings-section hud-settings-section-card" \},/g) ?? []).length, 4, "面板/上下文/用量/便笺四段都应渲染为卡片");
  assert.match(source, /\.hud-settings-section-card\{display:flex;flex-direction:column;gap:2px;padding:8px 12px 10px;border:1px solid/);
  assert.match(source, /className: "hud-settings-section-title" }, t\("settingsPanelTitle"\)\)/);
  assert.match(source, /className: "hud-settings-section-title" }, t\("settingsContextTitle"\)\)/);
  assert.match(source, /className: "hud-settings-section-title" }, t\("settingsUsageTitle"\)\)/);
  assert.match(source, /settingsContextBarStyle/);
  assert.match(source, /settingsContextStats/);
  assert.match(source, /settingsContextUsage/);
  // 右栏控件用官方 Switch / SegmentedControl（缺失时回退本地同等几何实现）。
  assert.match(source, /function HudSwitch\(props\) \{/);
  assert.match(source, /function HudSegmented\(props\) \{/);
  assert.match(source, /officialControl\("Switch"\)/);
  assert.match(source, /officialControl\("SegmentedControl"\)/);
  assert.match(source, /className: "hud-official-switch"/);
  assert.match(source, /className: "hud-official-switch-thumb"/);

  // 拖动排序：仅手柄可拖；列表级 dragover/drop 计算落点，其他卡片按预览顺序 transform 让位。
  assert.match(source, /className: "hud-settings-grip",/);
  assert.match(source, /draggable: true,/);
  assert.match(source, /react\.createElement\(Icon, \{ name: "drag", size: 14 \}\)/);
  assert.match(source, /const startDrag = \(event, key\) => \{/);
  assert.match(source, /const dragOverList = \(event\) => \{/);
  assert.match(source, /const dropList = \(event\) => \{/);
  assert.match(source, /ref: listRef,/);
  assert.match(source, /onDragOver: dragOverList,/);
  assert.match(source, /onDrop: dropList,/);
  assert.match(source, /dragRef\.current = \{ key, step, tops, order \};[\s\S]{0,400}suppressNativeDragImage\(event\);/);
  assert.doesNotMatch(source, /setDragImage\(card/);
  // 用指针所在的原始槽位计算落点，避免卡片位移后落点抖动。
  assert.match(source, /function moduleDropIndex\(tops, step, relY\) \{/);
  assert.match(source, /relY < top \+ step \/ 2/);
  assert.match(source, /const overIndex = moduleDropIndex\(state\.tops, state\.step, relY\);/);
  // 预览位移：不重排 DOM，松手后才写入 orderDraft。
  assert.match(source, /const next = previewModuleOrder\(state\.order, state\.key, overIndex\);/);
  assert.match(source, /state\.order = next;/);
  assert.match(source, /const previewIndex = dragPreview === null \? -1 : dragPreview\.order\.indexOf\(key\);/);
  assert.match(source, /style: offset === 0 \? undefined : \{ transform: `translateY\(\$\{offset\}px\)` \},/);
  assert.match(source, /const offset = previewIndex === -1 \|\| previewIndex === index \? 0 : \(previewIndex - index\) \* dragPreview\.step;/);
  assert.match(source, /if \(previewOrder !== null\) \{\n\t+setDragSettling\(true\);\n\t+setOrderDraft\(mergePreviewOrder\(orderDraft, orderedKeys, previewOrder\)\);/);
  // 落盘当帧关闭过渡，避免「新布局 + 旧位移」二次滑动。
  assert.match(source, /"data-settling": dragSettling,/);
  // v0.18.7：拖动期间在 document 捕获阶段接管 dragover/drop，松手点落在列表外也能落到首位/末位；
  // 列表自身收不到 drop 时由 dragend 兜底提交，不再「拖到首位又弹回原位」。
  assert.match(source, /const dragOverAt = \(event\) => \{/);
  assert.match(source, /const dragOverList = \(event\) => \{ dragOverAt\(event\); \};/);
  assert.match(source, /const commitDragOrder = \(\) => \{/);
  assert.match(source, /document\.addEventListener\("dragover", onOver, true\);/);
  assert.match(source, /document\.addEventListener\("drop", onDrop, true\);/);
  assert.match(source, /document\.removeEventListener\("dragover", onOver, true\);/);
  assert.match(source, /document\.removeEventListener\("drop", onDrop, true\);/);
  assert.match(source, /const endDrag = \(\) => \{\n\t+if \(!droppedRef\.current\) commitDragOrder\(\);/);
  assert.match(source, /const cancelDrag = \(\) => \{/);
  // 「恢复默认」不提交拖动的半成品，只清理拖动状态。
  // v0.20.0：「恢复默认」同时复位便笺上限，再取消拖动。
  assert.match(source, /setPanelDraft\(defaultPanelSettings\(\)\);\n\t+setNoteDraft\(defaultNoteSettings\(\)\);\n\t+cancelDrag\(\);/);
  assert.match(source, /\.hud-settings-list\[data-settling=true\] \.hud-settings-card\{transition:none\}/);
  assert.match(source, /transition:border-color \.12s var\(--ds-ease-in-out,ease\),background \.12s var\(--ds-ease-in-out,ease\),opacity \.12s var\(--ds-ease-in-out,ease\),transform \.16s var\(--ds-ease-in-out,ease\)/);

  // 底部按钮：恢复默认仅在非默认时激活，确认才落盘。
  assert.match(source, /className: "hud-settings-footer" },/);
  assert.match(source, /"data-kind": "reset",/);
  assert.match(source, /disabled: !dirty,/);
  assert.match(source, /const dirty = !isDefaultDraft\(draft, usageDraft, orderDraft, contextDraft, panelDraft, noteDraft, keys\);/);
  assert.match(source, /function isDefaultDraft\(draft, usageDraft, orderDraft, contextDraft, panelDraft, noteDraft, visibleModuleKeys\) \{/);
  // v0.20.0：确认时一并提交便笺上限草稿，且先做上限校验；未改动时「保存设置」置灰。
  assert.match(source, /disabled: !edited,\s*\n\s*onClick: confirmSettings,/);
  // v0.20.0：确认按钮文案改为「保存设置」，且未改动时置灰。
  assert.match(source, /t\("settingsConfirm"\)/);
  assert.match(source, /disabled: !edited,/);
  assert.match(source, /props\.onConfirm\(draft, usageDraft, orderDraft, contextDraft, panelDraft, noteDraft\);/);
  assert.match(source, /onClick: props\.onClose \}, t\("settingsCancel"\)\)/);
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
  assert.match(source, /call\("settings", \{ modules: nextModules, usage: nextUsage, context: nextContext, order: nextOrder, panel: nextPanel, note: nextNote \}\)/);
  // v0.18.2：面板设置随同一次请求落盘。
  assert.match(source, /const nextPanel = normalizePanelSettings\(panelPatch === undefined \? panelRef\.current : \{ \.\.\.panelRef\.current, \.\.\.panelPatch \}\);/);
  assert.match(source, /const nextOrder = orderPatch === undefined \? \(orderRef\.current \?\? defaultModuleOrder\(\)\) : normalizeModuleOrder\(orderPatch\);/);
  // 顺序是全局设置（不按会话），因此由面板层统一传给会话模块与设置菜单。
  assert.match(source, /order: moduleOrder,/);
  assert.match(source, /context: contextSettings,/);
  assert.match(source, /order: props\.order,/);
  assert.match(source, /context: props\.context,/);
  // v0.18.2：面板设置与用量置灰原因由面板层注入。
  assert.match(source, /panel: props\.panel,/);
  assert.match(source, /usageReasons: props\.usageReasons,/);
});

test("设置弹窗的关闭与焦点：Esc / 遮罩点击 / 取消确认，Tab 在弹窗内循环", async () => {
  const source = await clientSource();

  // 旧菜单的「点击外部关闭」整套 pointerdown 命中逻辑必须移除。
  assert.doesNotMatch(source, /hud-settings-pop/);
  assert.doesNotMatch(source, /doc\?\.addEventListener\?\.\("pointerdown", onPointerDown, true\)/);

  // 遮罩点击：只认遮罩本身，卡片内部点击不关闭。
  assert.match(source, /onClick: \(event\) => \{ if \(event\.target === event\.currentTarget\) props\.onClose\(\); \},/);
  assert.match(source, /onClick: \(event\) => event\.stopPropagation\(\),/);
  // Esc 在捕获阶段关闭；Tab 在弹窗内首尾循环。
  assert.match(source, /doc\?\.addEventListener\?\.\("keydown", onKeyDown, true\);/);
  assert.match(source, /doc\?\.removeEventListener\?\.\("keydown", onKeyDown, true\)/);
  assert.match(source, /if \(event\.key === "Escape"\) \{ event\.preventDefault\(\); props\.onClose\(\); return; \}/);
  assert.match(source, /if \(event\.key !== "Tab"\) return;/);
  assert.match(source, /event\.shiftKey && \(active === first \|\| active === cardRef\.current\)/);
  assert.match(source, /!event\.shiftKey && active === last/);
  // 打开时聚焦弹窗、关闭时把焦点还给触发元素。
  assert.match(source, /cardRef\.current\?\.focus\?\.\(\);/);
  assert.match(source, /previous\?\.focus\?\.\(\);/);

  // 关闭（含确认）只需收起弹窗，草稿保存仍走 onConfirm。
  assert.match(source, /const closeSettings = react\.useCallback\(\(\) => \{ setSettingsOpen\(false\); \}, \[\]\);/);
  assert.match(source, /props\.onSettingsChange\(draft, usageDraft, orderDraft, contextDraft, panelDraft, noteDraft\);\n\t\t\t\t\t\tcloseSettings\(\);/);
});
