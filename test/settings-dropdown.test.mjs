// dsh-awesome-hud — v0.21.0：「用量模块折叠后展示信息」官方样式下拉菜单
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { extractFunction, extractConst, clientSource as source } from './helpers/client-harness.mjs';

const OPTIONS = [
  { value: 'none', label: 'none' },
  { value: 'deepseek', label: 'deepseek' },
  { value: 'oc-5h', label: 'oc-5h', disabled: true },
  { value: 'oc-1w', label: 'oc-1w', disabled: true },
  { value: 'oc-1m', label: 'oc-1m', disabled: true },
  { value: 'codex-5h', label: 'codex-5h', disabled: true },
  { value: 'codex-1w', label: 'codex-1w', disabled: true },
];

/**
 * 下拉菜单运行时：Host 持有受控 value，验证「选择 → onChange → 触发器标签更新」。
 * primitives 传 null 走本地回退；传 { Menu } 走官方原语路径。
 */
function createRuntime(primitives = null) {
  const slots = [];
  const refs = [];
  const changes = [];
  let cursor = 0;
  const context = vm.createContext({
    primitives,
    isImeComposing: () => false,
    document: { body: {}, activeElement: null, addEventListener() {}, removeEventListener() {} },
    window: { innerWidth: 1280, innerHeight: 800 },
    globalThis: { addEventListener() {}, removeEventListener() {}, innerWidth: 1280, innerHeight: 800 },
  });
  context.react = {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => ({
      type,
      props: children.length === 0 ? (props ?? {}) : { ...(props ?? {}), children: children.length === 1 ? children[0] : children },
      children,
    }),
    useState(init) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof init === 'function' ? init() : init;
      return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useRef(value) {
      const index = cursor++;
      if (!(index in refs)) refs[index] = { current: value };
      return refs[index];
    },
    useEffect() {},
    useCallback(fn) { return fn; },
  };
  context.react_dom = { createPortal: node => node };
  vm.runInContext(
    `const HUD_MENU_WIDTH = 200;
     const HUD_MENU_ITEM_HEIGHT = 29;
     const HUD_MENU_DIVIDER_HEIGHT = 9;
     const HUD_MENU_PADDING = 12;
     const HUD_MENU_MARGIN = 8;
     const HUD_SELECT_WIDTH_MIN = 180;
     const HUD_SELECT_WIDTH_MAX = 320;
     const HUD_SELECT_ITEM_HEIGHT = 34;
     const HUD_SELECT_PADDING = 4;
     ${extractConst('HUD_CHEVRON_PATH')}
     ${extractConst('HUD_CHECK_PATH')}
     ${extractFunction('officialIcon')}
     ${extractFunction('officialControl')}
     ${extractFunction('viewportSize')}
     ${extractFunction('hudSelectMenuWidth')}
     ${extractFunction('selectMenuPlacement')}
     ${extractFunction('HudSelectGlyph')}
     ${extractFunction('HudSelect')}
     function Host(props) {
       const [value, setValue] = react.useState(props.initial);
       return react.createElement(HudSelect, {
         value,
         options: props.options,
         label: props.label ?? 'settingsUsageFolded',
         onChange: (next) => { props.onChange?.(next); setValue(next); },
       });
     }
     this.Host = Host;
     this.placement = selectMenuPlacement;
     this.menuWidth = hudSelectMenuWidth;`,
    context,
  );
  const expand = (node) => {
    if (node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === 'function' && node.type !== primitives?.Menu) return expand(node.type({ ...node.props, children: node.children }));
    return { ...node, children: (node.children ?? []).flat(Infinity).map(expand) };
  };
  let props = null;
  const render = (nextProps) => {
    if (nextProps !== undefined) props = nextProps;
    cursor = 0;
    // 统一记录受控 onChange，避免每个用例各自接线。
    return expand(context.Host({ ...props, onChange: (next) => changes.push(next) }));
  };
  return { render, changes, placement: context.placement, menuWidth: context.menuWidth };
}

const cls = (node) => node?.props?.className;
const nodes = (root) => {
  const out = [];
  const walk = (node) => {
    if (node === null) return;
    if (typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const child of node) walk(child); return; }
    out.push(node);
    walk(node.children ?? []);
  };
  walk(root);
  return out;
};
const byClass = (root, name) => nodes(root).filter(node => typeof cls(node) === 'string' && cls(node).split(' ').includes(name));
const textOf = (node) => (typeof node === 'string' ? node : (node?.children ?? []).flat(Infinity).map(textOf).join(''));
const triggerOf = (tree) => nodes(tree).find(node => node.type === 'button' && node.props?.className === 'hud-select-trigger');
const itemsOf = (tree) => nodes(tree).filter(node => node.type === 'button' && node.props?.role === 'menuitemradio');

test('触发器：受控标签、menu 语义与官方尺寸类名；未打开时不渲染菜单', () => {
  const runtime = createRuntime();
  const tree = runtime.render({ initial: 'deepseek', options: OPTIONS });
  const trigger = triggerOf(tree);
  assert.ok(trigger);
  assert.equal(trigger.props['aria-haspopup'], 'menu');
  assert.equal(trigger.props['aria-expanded'], false);
  assert.equal(trigger.props['aria-label'], 'settingsUsageFolded');
  assert.equal(textOf(byClass(tree, 'hud-select-label')[0]), 'deepseek');
  assert.equal(byClass(tree, 'hud-select-chevron').length, 1);
  assert.equal(byClass(tree, 'hud-select-menu').length, 0);
});

test('打开菜单：七个选项、选中对勾、不可用项置灰不可选', () => {
  const runtime = createRuntime();
  let tree = runtime.render({ initial: 'deepseek', options: OPTIONS });
  triggerOf(tree).props.onClick({ preventDefault() {}, stopPropagation() {} });
  tree = runtime.render();

  const menu = byClass(tree, 'hud-select-menu')[0];
  assert.ok(menu, '应渲染 portal 菜单');
  assert.equal(menu.props.role, 'menu');
  assert.equal(menu.props.style.width, 180, '默认最小宽度 180');
  const items = itemsOf(tree);
  assert.equal(items.length, 7);
  assert.deepEqual(items.map(item => item.props.key), OPTIONS.map(option => option.value));
  assert.deepEqual(items.map(item => item.props['aria-checked']), [false, true, false, false, false, false, false]);
  assert.deepEqual(items.map(item => item.props.disabled), [false, false, true, true, true, true, true]);
  // 选中项右侧对勾；其余项没有。
  assert.equal(byClass(items[1], 'hud-select-check').length, 1);
  assert.equal(byClass(items[0], 'hud-select-check').length, 0);
  // 不可用项点击不改变草稿。
  items[2].props.onClick();
  assert.deepEqual(runtime.changes, []);
  // 可用项点击 → onChange + 收起菜单 + 触发器标签更新。
  items[0].props.onClick();
  assert.deepEqual(runtime.changes, ['none']);
  tree = runtime.render();
  assert.equal(byClass(tree, 'hud-select-menu').length, 0, '选择后收起');
  assert.equal(textOf(byClass(tree, 'hud-select-label')[0]), 'none');
});

test('已选中但已不可用的值仍在触发器上正常显示', () => {
  const runtime = createRuntime();
  const tree = runtime.render({ initial: 'oc-5h', options: OPTIONS });
  assert.equal(textOf(byClass(tree, 'hud-select-label')[0]), 'oc-5h');
});

test('再次点击触发器等价收起菜单', () => {
  const runtime = createRuntime();
  let tree = runtime.render({ initial: 'none', options: OPTIONS });
  triggerOf(tree).props.onClick({ preventDefault() {}, stopPropagation() {} });
  tree = runtime.render();
  assert.equal(byClass(tree, 'hud-select-menu').length, 1);
  triggerOf(tree).props.onClick({ preventDefault() {}, stopPropagation() {} });
  tree = runtime.render();
  assert.equal(byClass(tree, 'hud-select-menu').length, 0);
});

test('菜单落点：右对齐触发器、下方 4px；底部放不下时翻到上方并夹取', () => {
  const runtime = createRuntime();
  const placement = runtime.placement;
  // 触发器矩形：右缘 500、底部 300，7 个选项。
  const below = placement({ left: 340, right: 500, top: 264, bottom: 300, width: 160 }, 7, runtime.menuWidth(160));
  assert.equal(below.width, 180);
  assert.equal(below.top, 304, '触发器下方 4px');
  assert.equal(below.left, 500 - 180, '右缘对齐');
  assert.equal(below.height, 4 * 2 + 7 * 34);

  // 底部放不下：翻到触发器上方（视口 800，底部 760）。
  const flipped = placement({ left: 340, right: 500, top: 700, bottom: 780, width: 160 }, 7, 180);
  assert.ok(flipped.top < 700, '应翻到上方');

  // 右对齐不越界时保持右缘对齐（1270 - 180 = 1090）。
  const aligned = placement({ left: 1200, right: 1270, top: 100, bottom: 136, width: 70 }, 7, 180);
  assert.equal(aligned.left, 1090);
  // 右缘超出视口时夹取到 1280 - 180 - 8。
  const clamped = placement({ left: 1320, right: 1500, top: 100, bottom: 136, width: 180 }, 7, 180);
  assert.equal(clamped.left, 1280 - 180 - 8);
});

test('官方 Menu 原语存在时也不使用：本地下拉可打开且层级高于设置弹窗', () => {
  const OfficialMenu = function OfficialMenu() {};
  const runtime = createRuntime({ Menu: OfficialMenu });
  let tree = runtime.render({ initial: 'deepseek', options: OPTIONS });

  // v0.21.0 修复：官方 Menu 的 portal 浮层 z-index 只有 1100，会被 HUD 弹窗遮住，
  // 因此即使原语可用也必须走本地下拉。
  assert.equal(nodes(tree).filter(node => node.type === OfficialMenu).length, 0, '不渲染官方 Menu');
  triggerOf(tree).props.onClick({ preventDefault() {}, stopPropagation() {} });
  tree = runtime.render();
  const menu = byClass(tree, 'hud-select-menu')[0];
  assert.ok(menu, '点击后应渲染本地下拉');
  const item = itemsOf(tree)[0];
  item.props.onClick();
  assert.deepEqual(runtime.changes, ['none']);
  // 源码级保证：本地下拉浮层（2147483005）高于设置弹窗（2147483001）。
  assert.match(source, /\.hud-select-menu\{position:fixed;z-index:2147483005;/);
  assert.match(source, /\.hud-modal\{position:fixed;inset:0;z-index:2147483001;/);
});

test('源码接线：Esc 捕获关闭、键盘方向键、本地浮层与样式实测值', () => {
  assert.match(source, /const official = officialIcon\(props\.kind === "check" \? "IconCheckOutline14" : "IconChevronDownOutline14"\);/);
  assert.match(source, /onKeyDown: moveFocus,/);
  assert.match(source, /event\.stopPropagation\?\.\(\);\n\t+\t+setOpen\(false\);/, 'Esc 在捕获阶段关闭且不冒泡到设置弹窗');
  // v0.21.0 修复：不再调用官方 Menu 原语（避免浮层被设置弹窗遮住）。
  assert.doesNotMatch(source, /officialControl\("Menu"\)/);
  assert.doesNotMatch(source, /selectedId: props\.value,/);
  // 触发器：官方 36px / 14px / 12px 圆角 / 模块底色。
  assert.match(source, /\.hud-select-trigger\{box-sizing:border-box;display:inline-flex;align-items:center;gap:12px;height:36px;min-width:0;max-width:220px;padding:0 14px;border:0;border-radius:var\(--dsw-radius-md,12px\);background:var\(--dsw-alias-bg-module-platform,var\(--hud-surface-bg\)\);/);
  // 菜单：4px 内边距 / 16px 圆角 / 官方材质与阴影。
  assert.match(source, /\.hud-select-menu\{position:fixed;z-index:2147483005;box-sizing:border-box;padding:4px;/);
  assert.match(source, /border-radius:var\(--dsw-radius-lg,16px\);background:var\(--dsw-menu-surface-fill,var\(--hud-surface-bg\)\)/);
  assert.match(source, /box-shadow:var\(--dsw-elevation-prominent,0 10px 34px rgba\(0,0,0,\.22\)\)/);
  // 条目：34px / 6px 8px / 12px 圆角 / 13px 字号。
  assert.match(source, /\.hud-select-item\{display:flex;align-items:center;gap:6px;width:100%;min-height:34px;padding:6px 8px;border:0;border-radius:var\(--dsw-radius-md,12px\);/);
  // 选中对勾 14px；不可用项置灰且不可点。
  assert.match(source, /react\.createElement\(HudSelectGlyph, \{ kind: "check", size: 14, className: "hud-select-check" \}\)/);
  assert.match(source, /\.hud-select-item:disabled\{color:var\(--dsw-alias-label-tertiary\);cursor:not-allowed;opacity:\.7\}/);
});
