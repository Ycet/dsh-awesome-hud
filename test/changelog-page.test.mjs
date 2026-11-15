// dsh-awesome-hud — v0.20.1：设置弹窗「更新日志」标签页
// 覆盖：版本数据契约（倒序、首条等于 package.json 版本）、字典键齐全、
// 标签行与页面结构、目录跳转与高亮、页脚常驻、样式、图标资产与内联兜底。
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODULE_KEYS, defaultModules, defaultUsageDisplay, defaultContextSettings, normalizeContextSettings,
  normalizeModuleOrder, defaultPanelSettings, normalizePanelSettings,
} from '../lib/settings.js';
import { extractFunction, extractConst, hudClient, nodes, clientSource } from './helpers/client-harness.mjs';
import { assetFileFor } from '../lib/index.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const USAGE_SETTING_KEYS = ['deepseek', 'opencode', 'codex'];
const MODULE_LABELS = Object.fromEntries(MODULE_KEYS.map(key => [key, () => `label:${key}`]));

/** 版本条目原文（与客户端同一词法环境求值，避免测试里再抄一份数据）。 */
const entries = vm.runInNewContext(`${extractConst('CHANGELOG_ENTRIES')}\nCHANGELOG_ENTRIES;`);
const sectionId = vm.runInNewContext(`${extractFunction('changelogSectionId')}\nchangelogSectionId;`);
const { zh, en } = hudClient().dictionaries[0];
const allKeys = entries.flatMap(entry => entry.groups.flatMap(group => [group.title, ...group.items]));
// 跨 realm 求值得到的数组原型不同，转成本 realm 的普通数组/字符串再断言。
const versions = [...entries].map(entry => String(entry.version));

/**
 * 极简 hooks 运行时（与 settings-guide 同一套思路）：
 * state 按调用顺序保存在槽位里，setState 后由测试重新渲染，从而真实走一遍
 * 「点标签 → 渲染更新日志页 → 点回设置页」的交互。
 */
function createRuntime() {
  const slots = [];
  const refs = [];
  let cursor = 0;
  const context = vm.createContext({
    // 官方控件不可用（null）→ 客户端走等价本地回退实现，与 settings-guide 的运行时一致。
    primitives: null,
    Icon: 'Icon',
    t: key => key,
    isImeComposing: () => false,
    suppressNativeDragImage: () => {},
    MODULE_KEYS: [...MODULE_KEYS],
    MODULE_LABELS,
    USAGE_SETTING_KEYS,
    normalizeUsageFolded: value => (['none', 'deepseek', 'oc-5h', 'oc-1w', 'oc-1m', 'codex-5h', 'codex-1w'].includes(value) ? value : 'none'),
    defaultModules,
    defaultUsageDisplay,
    defaultContextSettings,
    normalizeContextSettings,
    normalizeModuleOrder,
    defaultPanelSettings,
    normalizePanelSettings,
    NOTE_COUNT_MIN: 5,
    NOTE_COUNT_MAX: 20,
    defaultNoteSettings: () => ({ maxCount: 5, popupEdit: false }),
    normalizeNoteMaxCount: value => {
      const number = Number(value);
      return Number.isFinite(number) ? Math.min(20, Math.max(5, Math.round(number))) : 5;
    },
    defaultGitSettings: () => ({ view: 'list' }),
    normalizeGitView: value => value === 'tree' ? 'tree' : 'list',
    normalizeGitSettings: raw => ({ view: raw?.view === 'tree' ? 'tree' : 'list' }),
    GIT_VIEW_DEFAULT: 'list',
    normalizeNoteSettings: raw => ({ maxCount: raw?.maxCount === undefined ? 5 : Math.min(20, Math.max(5, Math.round(Number(raw.maxCount)))), popupEdit: raw?.popupEdit === true }),
    noteCountViolations: () => [],
    toast: () => {},
    IME_INPUT_PROPS: {},
    window: { clearTimeout() {}, setTimeout() {} },
    document: { activeElement: null },
    // 真实浏览器里 scrollIntoView 存在；测试给一个可断言调用次数的桩。
    scrolled: [],
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
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
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
    [
      `const HUD_MENU_WIDTH = 200;`,
      `const HUD_MENU_ITEM_HEIGHT = 29;`,
      `const HUD_MENU_DIVIDER_HEIGHT = 9;`,
      `const HUD_MENU_PADDING = 12;`,
      `const HUD_MENU_MARGIN = 8;`,
      `const RESET_MENU_WIDTH = 248;`,
      `const HUD_SELECT_WIDTH_MIN = 180;`,
      `const HUD_SELECT_WIDTH_MAX = 320;`,
      `const HUD_SELECT_ITEM_HEIGHT = 34;`,
      `const HUD_SELECT_PADDING = 4;`,
      `const CHANGELOG_MAX_VERSIONS = 20;`,
      extractConst('HUD_CHEVRON_PATH'),
      extractConst('HUD_CHECK_PATH'),
      extractFunction('guideActiveKey'),
      extractConst('GUIDE_SECTIONS'),
      extractConst('CHANGELOG_ENTRIES'),
      extractFunction('changelogEntriesForPage'),
      extractFunction('changelogSectionId'),
      extractFunction('officialIcon'),
      extractFunction('officialControl'),
      extractFunction('viewportSize'),
      extractFunction('clampMenuPosition'),
      extractFunction('menuAnchorFrom'),
      extractFunction('HudMenu'),
      extractFunction('hudSelectMenuWidth'),
      extractFunction('selectMenuPlacement'),
      extractFunction('HudSelectGlyph'),
      extractFunction('HudSelect'),
      extractFunction('HudSwitch'),
      extractFunction('HudSegmented'),
      extractFunction('HudNumberStepper'),
      extractFunction('SettingRow'),
      extractFunction('SettingsGuide'),
      extractFunction('SettingsChangelog'),
      extractFunction('sameOrder'),
      extractFunction('sameSettingsDraft'),
      extractFunction('isDefaultModulesSettings'),
      extractFunction('isDefaultFeatureSettings'),
      extractFunction('isDefaultDraft'),
      extractFunction('contextPinState'),
      extractFunction('SettingsDialog'),
    ].join('\n'),
    context,
  );
  const expand = node => {
    if (node === null || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return { ...node, children: (node.children ?? []).flat(Infinity).map(expand) };
  };
  let props = null;
  let last = null;
  return {
    entries: JSON.parse(JSON.stringify(vm.runInContext('CHANGELOG_ENTRIES', context))),
    render(nextProps) {
      if (nextProps !== undefined) props = nextProps;
      cursor = 0;
      last = expand(context.SettingsDialog(props));
      return last;
    },
  };
}

function baseProps(overrides = {}) {
  return {
    modules: defaultModules(),
    usage: defaultUsageDisplay(),
    context: defaultContextSettings(),
    order: normalizeModuleOrder(null),
    panel: defaultPanelSettings(),
    balanceAvailable: true,
    usageAvailability: { deepseek: true, opencode: true, codex: true },
    usageReasons: {},
    onClose() {},
    onConfirm() {},
    ...overrides,
  };
}

const classOf = node => node?.props?.className;
const byClass = (rootNode, name) => nodes(rootNode).filter(node => classOf(node) === name);
const textOf = node => {
  if (typeof node === 'string') return node;
  if (node === null || typeof node !== 'object') return '';
  return (node.children ?? []).flat(Infinity).map(textOf).join('');
};
const findTab = (rootNode, key) => nodes(rootNode).find(node => node.type === 'button' && node.props?.role === 'tab' && node.props?.id === `hud-settings-tab-${key}`);
const clickTab = (rootNode, key) => findTab(rootNode, key).props.onClick();
const footerButtons = rootNode => nodes(rootNode).filter(node => node.type === 'button' && node.props?.['data-kind']);

test('版本数据：每个版本带合法更新时间，目录与卡片都展示', () => {
  for (const entry of entries) assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/, `${entry.version} 更新时间格式`);
  const runtime = createRuntime();
  let dialog = runtime.render(baseProps());
  clickTab(dialog, 'changelog');
  dialog = runtime.render();
  assert.equal(byClass(dialog, 'hud-guide-toc-date').length, versions.length);
  assert.equal(byClass(dialog, 'hud-changelog-date').length, versions.length);
});

test('版本数据：倒序、版本号格式、首条等于 package.json 版本、键唯一、最多 20 条', () => {
  assert.ok(entries.length >= 2, '至少覆盖 v0.20.1 与 v0.20.0');
  // v0.21.0：数据源只保留最新 20 个版本（更旧记录删除，避免持续膨胀）。
  assert.ok(entries.length <= 20, `版本条目不得超过 20 条，实际 ${entries.length}`);
  assert.deepEqual(
    JSON.parse(JSON.stringify(entries[0].groups.map(group => group.title))),
    ['changelog021GroupNote', 'changelog021GroupReset', 'changelog021GroupChangelog', 'changelog021GroupUsage', 'changelog021GroupGit', 'changelog021GroupOutputs', 'changelog021GroupPanel'],
    'v0.21.0 的七个分组',
  );
  const pattern = /^v\d+\.\d+\.\d+$/;
  for (const version of versions) assert.match(version, pattern);
  // 倒序：逐个比较主/次/修订号三段。
  const parts = versions.map(version => version.slice(1).split('.').map(Number));
  for (let index = 1; index < parts.length; index += 1) {
    const [aMaj, aMin, aPat] = parts[index - 1];
    const [bMaj, bMin, bPat] = parts[index];
    assert.ok(aMaj * 1e6 + aMin * 1e3 + aPat > bMaj * 1e6 + bMin * 1e3 + bPat, `${versions[index - 1]} 必须早于 ${versions[index]}`);
  }
  // 首条即当前版本：升版时忘记补条目会在这里失败。
  assert.equal(versions[0], `v${manifest.version}`, '当前版本必须排在第一条');
  for (const entry of entries) {
    assert.ok(entry.groups.length >= 1, `${entry.version} 至少一个分组`);
    for (const group of entry.groups) {
      assert.equal(typeof group.title, 'string');
      assert.ok(group.items.length >= 1, `${entry.version}/${group.title} 至少要一条要点`);
    }
  }
  const seen = new Set();
  for (const key of allKeys) {
    assert.equal(seen.has(key), false, `键不能重复：${key}`);
    seen.add(key);
  }
});

test('页面最多展示最新 20 个版本：changelogEntriesForPage 截取前 20 条', () => {
  const pageFn = vm.runInNewContext(`${extractConst('CHANGELOG_MAX_VERSIONS')}\n${extractFunction('changelogEntriesForPage')}\nchangelogEntriesForPage;`);
  const synthetic = Array.from({ length: 25 }, (_, index) => ({ version: `v0.${25 - index}.0`, groups: [] }));
  const capped = pageFn(synthetic);
  assert.equal(capped.length, 20, '最多 20 条');
  assert.equal(capped[0].version, 'v0.25.0', '保留最新的在前');
  assert.equal(capped[19].version, 'v0.6.0');
  assert.equal(synthetic.length, 25, '不修改入参');
  assert.deepEqual(JSON.parse(JSON.stringify(pageFn(null))), [], '非数组安全返回空');
  // 当前数据源不超过上限时原样返回。
  assert.equal(pageFn(entries).length, entries.length);
});

test('版本数据：分组标题与要点在中英字典里成对存在', () => {
  for (const key of allKeys) {
    assert.equal(typeof zh[key], 'string', `${key} 需要中文文案`);
    assert.equal(typeof en[key], 'string', `${key} 需要英文文案`);
    assert.ok(zh[key].length > 0 && en[key].length > 0, `${key} 文案不能为空`);
  }
  for (const key of ['settingsChangelogTab', 'changelogLatest']) {
    assert.equal(typeof zh[key], 'string');
    assert.equal(typeof en[key], 'string');
  }
  // 中英 changelog 键集合一致（不出现单侧漏写）。
  const keysOf = dict => Object.keys(dict).filter(key => key.startsWith('changelog') || key === 'settingsChangelogTab').sort();
  assert.deepEqual(keysOf(zh), keysOf(en));
});

test('changelogSectionId：版本号转成合法锚点 id，幂等且可逆推', () => {
  assert.equal(sectionId('v0.20.1'), 'hud-changelog-section-v0-20-1');
  assert.equal(sectionId('v0.20.1'), sectionId('v0.20.1'));
  assert.equal(sectionId('v1.2.3'), 'hud-changelog-section-v1-2-3');
  assert.doesNotMatch(sectionId('v0.20.1'), /[^a-z0-9-]/);
});

test('页面结构：第三个标签打开更新日志页，左栏版本号与右栏版本卡片一致', () => {
  const runtime = createRuntime();
  let dialog = runtime.render(baseProps());
  clickTab(dialog, 'changelog');
  dialog = runtime.render();

  const page = byClass(dialog, 'hud-settings-changelog');
  assert.equal(page.length, 1, '更新日志页应渲染');
  assert.equal(page[0].props.role, 'tabpanel');
  assert.equal(page[0].props.id, 'hud-settings-panel-changelog');
  assert.equal(page[0].props['aria-labelledby'], 'hud-settings-tab-changelog');

  // 左栏：版本号目录（倒序），文案就是版本号本身。
  const toc = byClass(dialog, 'hud-guide-toc-item');
  // v0.21.0：目录行追加更新时间，版本号本身在 label 内。
  assert.deepEqual(byClass(dialog, 'hud-guide-toc-label').map(textOf), versions);
  assert.equal(JSON.stringify(byClass(dialog, 'hud-guide-toc-date').map(textOf)), JSON.stringify(entries.map((entry) => entry.date)), '目录行展示日期');
  assert.equal(toc[0].props['data-active'], true, '默认高亮最新版本');
  assert.deepEqual(toc.slice(1).map(node => node.props['data-active']), versions.slice(1).map(() => false));

  // 右栏：每个版本一张卡片，卡片内按分组列要点。
  const cards = byClass(dialog, 'hud-guide-section hud-changelog-version');
  assert.equal(cards.length, entries.length);
  for (const [index, entry] of entries.entries()) {
    const card = cards[index];
    assert.equal(card.props.id, sectionId(entry.version));
    assert.equal(card.props['data-version'], entry.version);
    const title = byClass(card, 'hud-guide-section-title')[0];
    const badges = byClass(card, 'hud-changelog-badge');
    assert.equal(textOf(title), `${entry.version}${index === 0 ? 'changelogLatest' : ''}${entry.date}`);
    assert.equal(byClass(card, 'hud-changelog-date')[0].children[0], entry.date, '卡片标题展示更新时间');
    assert.equal(badges.length, index === 0 ? 1 : 0, '只有首条带「最新」徽标');
    const groups = byClass(card, 'hud-changelog-group');
    assert.equal(groups.length, entry.groups.length);
    for (const [groupIndex, group] of entry.groups.entries()) {
      assert.equal(textOf(byClass(groups[groupIndex], 'hud-changelog-group-title')[0]), group.title);
      assert.deepEqual(byClass(groups[groupIndex], 'hud-guide-item').map(textOf), [...group.items]);
    }
  }
});

test('目录跳转：点另一个版本号即高亮该版本，切回设置页后草稿仍在', () => {
  const runtime = createRuntime();
  let dialog = runtime.render(baseProps());
  clickTab(dialog, 'changelog');
  dialog = runtime.render();

  const toc = () => byClass(dialog, 'hud-guide-toc-item');
  assert.equal(toc()[0].props['data-active'], true);
  toc()[1].props.onClick();
  dialog = runtime.render();
  assert.equal(toc()[1].props['data-active'], true, '点击后高亮切到该版本');
  assert.equal(toc()[0].props['data-active'], false);
  assert.equal(toc()[1].props['aria-current'], 'true');

  clickTab(dialog, 'settings');
  dialog = runtime.render();
  assert.equal(byClass(dialog, 'hud-settings-panes')[0].props['data-hidden'], false);
});

test('页脚：更新日志页同样常驻「恢复默认 / 保存设置」，未改动时都置灰', () => {
  const runtime = createRuntime();
  let dialog = runtime.render(baseProps());
  clickTab(dialog, 'changelog');
  dialog = runtime.render();
  assert.deepEqual(footerButtons(dialog).map(node => node.props['data-kind']), ['reset', 'confirm']);
  assert.equal(footerButtons(dialog)[0].props.disabled, true);
  assert.equal(footerButtons(dialog)[1].props.disabled, true);
  // 设置页此时仍挂载（作为高度基准）但不可交互。
  assert.equal(byClass(dialog, 'hud-settings-panes')[0].props['data-hidden'], true);
});

test('样式：更新日志页与说明页同一套绝对定位覆盖、分组标题与徽标有独立规则', () => {
  assert.match(clientSource, /\.hud-settings-changelog\{position:absolute;inset:0;display:flex;align-items:stretch\}/);
  assert.match(clientSource, /\.hud-changelog-group\{display:flex;flex-direction:column;gap:4px;min-width:0\}/);
  assert.match(clientSource, /\.hud-changelog-group-title\{font-size:12px;line-height:18px;font-weight:600/);
  assert.match(clientSource, /\.hud-changelog-badge\{flex:none;margin-left:8px;border-radius:999px/);
  // 页面内复用说明页的分栏与卡片类，因此左栏宽度、分割线与滚动行为完全一致。
  assert.match(clientSource, /className: "hud-settings-changelog"/);
  assert.match(clientSource, /className: "hud-guide-toc"/);
  assert.match(clientSource, /className: "hud-guide-content"/);
  // 高亮复用说明页的纯函数，不再重复实现一份。
  assert.match(clientSource, /guideActiveKey\(versions, offsets/);
});

test('图标资产：changelog.svg 已入库、清理干净、宿主白名单放行', () => {
  const file = resolve(root, 'assets/icons/changelog.svg');
  assert.ok(existsSync(file), '图标文件必须随包入库');
  const text = readFileSync(file, 'utf8');
  assert.match(text, /viewBox="0 0 1024 1024"/);
  assert.match(text, /fill="currentColor"/, '单色图标必须用 currentColor 跟随主题');
  assert.doesNotMatch(text, /darkreader/i, '去掉设计工具的暗色插件属性');
  assert.doesNotMatch(text, /p-id=|data-darkreader|style="--darkreader/);
  const asset = assetFileFor('changelog.svg');
  assert.ok(asset.path.endsWith('/assets/icons/changelog.svg'), asset.path);
  assert.equal(asset.contentType, 'image/svg+xml');
});

test('图标加载：宿主资产 404 时回退内联 SVG，其它图标仍按原样报错', async () => {
  const context = vm.createContext({
    // 模拟旧宿主：白名单未放行 → 资产路由 404。
    fetch: async () => ({ ok: false, status: 404, text: async () => '' }),
    hostBase: () => 'http://test',
    console,
  });
  vm.runInContext(
    [
      extractConst('ASSET_PATH'),
      extractConst('ICON_CACHE'),
      extractConst('INLINE_ICONS'),
      extractConst('FALLBACK_ICONS'),
      extractFunction('iconKey'),
      extractFunction('adaptIcon'),
      extractFunction('loadIcon'),
    ].join('\n'),
    context,
  );
  const changelog = await vm.runInContext("loadIcon('changelog', false)", context);
  assert.match(changelog, /viewBox="0 0 1024 1024"/, '回退图标必须是「更新记录」图形');
  assert.match(changelog, /fill="currentColor"/);
  assert.match(changelog, /width="16"/, '统一渲染为 16px');
  // 缓存复用同一个 Promise 结果。
  assert.equal(await vm.runInContext("loadIcon('changelog', false)", context), changelog);
  await assert.rejects(() => vm.runInContext("loadIcon('not-registered', false)", context), /HTTP 404/);
});
