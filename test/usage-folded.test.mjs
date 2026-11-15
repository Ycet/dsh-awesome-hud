// dsh-awesome-hud — v0.20.1：「用量」模块折叠后展示信息（跳转按钮已移除）
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { clientSource as source, extractFunction, nodes } from './helpers/client-harness.mjs';

const body = extractFunction('BalanceModule');
const DS_BALANCE = { available: true, data: { toppedUp: 2.31, granted: 0.01, currency: 'CNY' }, error: null };

/** 渲染「用量」模块：返回元素树与 ModuleHead。 */
function render(overrides = {}) {
  const react = {
    createElement: (type, props, ...children) => ({
      type,
      props: children.length === 0 ? (props ?? {}) : { ...(props ?? {}), children: children.length === 1 ? children[0] : children },
      children,
    }),
    Fragment: 'fragment',
    useState: init => [typeof init === 'function' ? init() : init, () => {}],
    useRef: () => ({ current: null }),
  };
  const context = vm.createContext({
    react,
    react_dom: { createPortal: node => node },
    Icon: 'Icon',
    ModuleHead: 'ModuleHead',
    t: key => key,
    interpolate: (text, values) => text === 'usageFoldedValue' ? `（${values.value}）` : text.replace('{value}', values.value),
    fmtBalanceMoney: (value, currency) => `${value}${currency ?? ''}`,
    fmtOcPercent: value => `${value}%`,
    fmtCodexPercent: value => `${value?.remainingPercent ?? value}%`,
    normalizeUsageFolded: value => (typeof value === 'string' ? value : 'none'),
    selectCodexReserveLimits: () => [],
    window: { open() {}, innerWidth: 1280 },
    document: { body: {}, addEventListener() {}, removeEventListener() {} },
    openSettingsAccount() {},
  });
  vm.runInContext(body, context);
  const props = {
    balance: DS_BALANCE,
    opencode: null,
    codex: null,
    display: null,
    fold: true,
    ...overrides,
  };
  const element = vm.runInContext(`BalanceModule(${JSON.stringify(props)})`, context);
  return { element, head: element.children.find(child => child?.type === 'ModuleHead') };
}

/** 从折叠摘要里取图标、标签与数值。 */
function summaryOf(head) {
  const extra = head.props.extra;
  assert.ok(extra, '折叠时应渲染摘要');
  const icon = nodes(extra).find(node => node?.props?.name !== undefined);
  const label = nodes(extra).find(node => node?.props?.className === 'hud-usage-folded-label');
  const value = nodes(extra).find(node => node?.props?.className === 'hud-usage-folded-value');
  return { icon, label, value };
}

test('跳过：折叠摘要为 none 时不渲染任何额外内容', () => {
  for (const display of [null, { deepseek: true, opencode: true, codex: true }, { folded: 'none' }]) {
    assert.equal(render({ display, fold: true }).head.props.extra, null);
  }
  // 展开时也不展示摘要。
  assert.equal(render({ display: { folded: 'deepseek' }, fold: false }).head.props.extra, null);
});

test('DeepSeek 余额：图标 + （金额），无 5h/1w 标签', () => {
  const { head } = render({ display: { folded: 'deepseek' } });
  const { icon, label, value } = summaryOf(head);
  assert.equal(icon.props.name, 'deepseek');
  assert.equal(label, undefined);
  assert.equal(value.children[0], '（2.32CNY）');
});

test('OpenCode Go：图标 + 5h/1w/1m + （百分比）', () => {
  const opencode = { available: true, usage: { rolling: 7.5, weekly: 21, monthly: 49 } };
  for (const [folded, label, percent] of [['oc-5h', '5h', '7.5%'], ['oc-1w', '1w', '21%'], ['oc-1m', '1m', '49%']]) {
    const { head } = render({ display: { folded }, opencode });
    const summary = summaryOf(head);
    assert.equal(summary.icon.props.name, 'icon-opencode');
    assert.equal(summary.label.children[0], label);
    assert.equal(summary.value.children[0], `（${percent}）`);
  }
  // 数据不可用时不渲染摘要（设置里对应选项也会置灰）。
  assert.equal(render({ display: { folded: 'oc-5h' }, opencode: null }).head.props.extra, null);
});

test('Codex 已订阅：5h/1w 额度；未订阅时降级为（免费额度）', () => {
  const subscribed = { available: true, usage: { mode: 'subscription', fiveHour: { remainingPercent: 40 }, weekly: { remainingPercent: 70 } } };
  const five = summaryOf(render({ display: { folded: 'codex-5h' }, codex: subscribed }).head);
  assert.equal(five.icon.props.name, 'ChatGPT');
  assert.equal(five.label.children[0], '5h');
  assert.equal(five.value.children[0], '（40%）');
  const week = summaryOf(render({ display: { folded: 'codex-1w' }, codex: subscribed }).head);
  assert.equal(week.label.children[0], '1w');
  assert.equal(week.value.children[0], '（70%）');

  const free = { available: true, usage: { mode: 'free', free: { remainingPercent: 88 } } };
  for (const folded of ['codex-5h', 'codex-1w']) {
    const summary = summaryOf(render({ display: { folded }, codex: free }).head);
    assert.equal(summary.icon.props.name, 'ChatGPT');
    assert.equal(summary.label, undefined, '免费额度降级展示不带 5h/1w 标签');
    assert.equal(summary.value.children[0], '（88%）');
  }
  // Codex 不可用时不渲染摘要。
  assert.equal(render({ display: { folded: 'codex-5h' }, codex: null }).head.props.extra, null);
});

test('「跳转」按钮与 showJump 已彻底移除', () => {
  assert.doesNotMatch(source, /balanceJump|settingsUsageJump|showJump/);
  assert.doesNotMatch(source, /DEEPSEEK_PLATFORM_URL|OPENCODE_GO_PAGE_URL/);
  assert.match(source, /settingsUsageFolded: "用量模块折叠后展示信息",/);
  assert.match(source, /settingsUsageFolded: "Folded usage display",/);
  assert.match(source, /usageFoldedValue: "（\{value\}）",/);
  assert.match(source, /usageFoldedValue: "\(\{value\}\)",/);
});
