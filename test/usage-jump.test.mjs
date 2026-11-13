// dsh-awesome-hud — v0.18.2：「用量」模块的「跳转」按钮开关
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { extractFunction, nodes } from './helpers/client-harness.mjs';

const body = extractFunction('BalanceModule');

/** 渲染「用量」模块：返回元素树与被打开过的外链地址。 */
function render(overrides = {}) {
  const calls = [];
  const opened = [];
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
    interpolate: (text, values) => text,
    fmtBalanceMoney: (value, currency) => `${value}${currency ?? ''}`,
    fmtOcPercent: value => `${value}%`,
    fmtCodexPercent: value => `${value}%`,
    selectCodexReserveLimits: () => [],
    DEEPSEEK_PLATFORM_URL: 'https://platform.example',
    OPENCODE_GO_PAGE_URL: 'https://oc.example',
    window: { open: url => opened.push(url), innerWidth: 1280 },
    document: { body: {}, addEventListener() {}, removeEventListener() {} },
    openSettingsAccount: target => calls.push(target),
  });
  vm.runInContext(body, context);
  const props = {
    balance: { available: true, data: { toppedUp: 2.31, granted: 0.01, currency: 'CNY' }, error: null },
    opencode: null,
    codex: null,
    display: null,
    fold: false,
    ...overrides,
  };
  const element = vm.runInContext(`BalanceModule(${JSON.stringify(props)})`, context);
  const head = element.children.find(child => child?.type === 'ModuleHead');
  return { element, head, calls, opened, context };
}

test('默认（未配置）与显式启用时，模块头渲染「跳转」按钮', () => {
  for (const display of [null, { deepseek: true, opencode: true, codex: true }, { showJump: true }]) {
    const { head } = render({ display });
    assert.equal(head.props.extra?.type, 'button', `display=${JSON.stringify(display)} 时应展示跳转按钮`);
    assert.equal(head.props.extra.children[0], 'balanceJump');
  }
});

test('关闭「跳转」按钮后不再渲染按钮，也就无法打开跳转菜单', () => {
  const display = { deepseek: true, opencode: true, codex: true, showJump: false };
  const { head } = render({ display });
  assert.equal(head.props.extra, null, '跳转按钮必须完全不渲染（不是置灰）');
  // 菜单是按钮的子级浮层：按钮不存在时整棵树里也没有跳转菜单项。
  const menuItems = nodes(head).filter(node => node?.props?.role === 'menuitem');
  assert.equal(menuItems.length, 0);
});

test('关闭「跳转」不影响三行用量数据本身', () => {
  const display = { deepseek: true, opencode: true, codex: true, showJump: false };
  const { element } = render({
    display,
    opencode: { available: true, usage: { rolling: 7.5, weekly: 21, monthly: 49 } },
  });
  const rows = nodes(element).filter(node => node?.props?.className === 'hud-row hud-usage-row');
  // DeepSeek 一行 + OpenCode Go 三行
  assert.equal(rows.length, 4);
  assert.equal(nodes(element).filter(node => node?.props?.className === 'hud-btn-small hud-git-btn').length, 0);
});

test('没有可用数据源时本来就没有跳转按钮，开关不影响渲染结果', () => {
  const empty = render({ balance: null, opencode: null, codex: null, display: { showJump: true } });
  assert.equal(empty.head.props.extra, null);
  const closed = render({ balance: null, opencode: null, codex: null, display: { showJump: false } });
  assert.equal(closed.head.props.extra, null);
});
