import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { clientSource as source, extractFunction, nodes, settled } from './helpers/client-harness.mjs';

// 「用量」模块可见性：即使没有任何数据源（未装 dsh-account-usage / 未登录 Codex），
// 模块仍渲染；DeepSeek 余额行显示 — 且点击仍打开「设置 → 账号与余额」。
const body = extractFunction('BalanceModule');
const rowsOf = (container) => nodes(container).filter(node => node?.props?.className === 'hud-row hud-usage-row');
const hintsOf = (container) => nodes(container).filter(node => node?.props?.className === 'hud-git-summary');

function render(overrides = {}) {
  const calls = [];
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: 'fragment',
    useState: init => [typeof init === 'function' ? init() : init, () => {}],
    useRef: () => ({ current: null }),
  };
  const context = vm.createContext({
    react,
    react_dom: { createPortal: () => null },
    Icon: 'Icon',
    ModuleHead: props => ({ type: 'ModuleHead', props, children: [] }),
    t: key => key,
    interpolate: (text, values) => text,
    fmtBalanceMoney: (value, currency) => `${value}${currency ?? ''}`,
    fmtOcPercent: value => `${value}%`,
    fmtCodexPercent: value => `${value}%`,
    selectCodexReserveLimits: () => [],
    DEEPSEEK_PLATFORM_URL: 'https://platform.example',
    OPENCODE_GO_PAGE_URL: 'https://oc.example',
    window: { open() {}, innerWidth: 1280 },
    document: { body: {}, addEventListener() {}, removeEventListener() {} },
    openSettingsAccount: target => calls.push(target),
  });
  vm.runInContext(body, context);
  const props = {
    balance: null, opencode: null, codex: null, display: null, fold: false,
    ...overrides,
  };
  const element = vm.runInContext(`BalanceModule(${JSON.stringify(props)})`, context);
  return { element, calls, body: element.children[1] };
}

test('没有任何数据源时仍渲染模块：DeepSeek 行显示 — 且点击打开账号与余额', () => {
  const { body: bodyEl, calls } = render();
  const rows = bodyEl.children;
  const dsRow = rows[0];
  assert.equal(dsRow.props.className, 'hud-row hud-usage-row');
  assert.equal(dsRow.children[0].props.name, 'deepseek');
  assert.equal(dsRow.children[1].children[0], 'balanceTotal');
  assert.equal(dsRow.children[2].props.className, 'hud-balance-value hud-click');
  assert.equal(dsRow.children[2].children[0], '—');
  dsRow.children[2].props.onClick();
  assert.deepEqual(calls, ['deepseek']);
  // OpenCode Go / Codex 无数据时不渲染行
  assert.equal(rows.filter(row => row?.children?.[0]?.props?.name === 'icon-opencode').length, 0);
  assert.equal(rows.filter(row => row?.children?.[0]?.props?.name === 'ChatGPT').length, 0);
  // 末尾给出接入提示
  const hint = rows.at(-1);
  assert.equal(hint.props.className, 'hud-git-summary');
  assert.equal(hint.children[0], 'usageEmptyHint');
});

test('仅有 DeepSeek 余额（官方账户兜底）时展示金额并保持可点击', () => {
  const { body: bodyEl, calls } = render({
    balance: { available: true, data: { toppedUp: 2.31, granted: 0.01, currency: 'CNY' }, error: null },
  });
  const value = bodyEl.children[0].children[2];
  assert.equal(value.children[0], '2.32CNY');
  value.props.onClick();
  assert.deepEqual(calls, ['deepseek']);
  // 已有可用数据，不显示接入提示
  assert.equal(bodyEl.children.filter(row => row?.props?.className === 'hud-git-summary').length, 0);
});

test('OpenCode Go 数据可用时三行可点击；缺失时整组不渲染', () => {
  const withOc = render({
    opencode: { available: true, usage: { rolling: 7.5, weekly: 21, monthly: 49 } },
  });
  const ocRows = rowsOf(withOc.body).filter(row => row.children[0]?.props?.name === 'icon-opencode');
  assert.equal(ocRows.length, 3);
  assert.deepEqual(ocRows.map(row => row.children[2].children[0]), ['7.5%', '21%', '49%']);
  ocRows[0].children[2].props.onClick();
  assert.deepEqual(withOc.calls, ['opencode']);
  assert.equal(hintsOf(withOc.body).length, 0);

  const withoutOc = render();
  assert.equal(rowsOf(withoutOc.body).filter(row => row.children[0]?.props?.name === 'icon-opencode').length, 0);
});

test('Codex 数据可用时仍按原结构渲染（免费额度互斥分支）', () => {
  const { body: bodyEl } = render({
    codex: { available: true, usage: { mode: 'free', free: 87.5, fiveHour: null, weekly: null } },
  });
  const codexRows = rowsOf(bodyEl).filter(row => row.children[0]?.props?.name === 'ChatGPT');
  assert.equal(codexRows.length, 1);
  assert.equal(codexRows[0].children[1].children[0], 'codexFreeQuota');
  assert.equal(codexRows[0].children[2].children[0], '87.5%');
});

test('折叠或手动隐藏 DeepSeek 行时结构正确', () => {
  assert.equal(render({ fold: true }).element.children[1], null);
  const hidden = render({ display: { deepseek: false } });
  assert.equal(rowsOf(hidden.body).length, 0);
  const hints = hintsOf(hidden.body);
  assert.equal(hints.length, 1);
  assert.equal(hints[0].children[0], 'usageEmptyHint');
});

test('模块渲染不再以数据可用性为前提，余额可通过 host 路由兜底', () => {
  assert.match(source, /activeModules\.balance === false\s*\n\s*\? null\s*\n\s*: react\.createElement\(BalanceModule/);
  assert.doesNotMatch(source, /activeModules\.balance === false \|\| !usageAvailable/);
  assert.match(source, /balanceAvailable: true,/);
  assert.match(source, /call\("usage\/account", clientMetadata\(\)\)/);
  assert.match(source, /__DSH_BOOT__\?\.release\?\.version/);
});

test('设置页缺少 dsh-account-usage 页签时静默停留「账号与余额」', () => {
  assert.ok(source.includes('const tab = await waitForOptional(() => findButton(dialog, target === "opencode"'));
  assert.ok(source.includes('tab?.click();'));
});

// 余额轮询 effect：抽取真实实现，验证「account-usage 路由失败 → host 官方账户兜底」。
const pollStart = source.indexOf('const [balance, setBalance] = useModuleSnapshot("balance", null);');
const pollEnd = source.indexOf('}, []);', pollStart) + '}, []);'.length;
const pollSnippet = source.slice(pollStart, pollEnd);

async function pollBalance({ summary, hostBalance }) {
  const hostCalls = [];
  let balanceValue = null;
  let opencodeValue = null;
  const context = vm.createContext({
    react: { useEffect: fn => fn() },
    useModuleSnapshot: (key, fallback) => {
      if (key === 'balance') return [balanceValue, next => { balanceValue = typeof next === 'function' ? next(balanceValue) : next; }];
      if (key === 'opencode') return [opencodeValue, next => { opencodeValue = typeof next === 'function' ? next(opencodeValue) : next; }];
      return [null, () => {}];
    },
    ctx: { locale: { getSnapshot: () => ({ active: 'zh-CN' }) }, get: () => undefined },
    hostBase: () => 'http://host',
    ACCOUNT_SUMMARY_URL: '/api/account-usage/deepseek-summary',
    ACCOUNT_OPENCODE_URL: '/api/account-usage/opencode',
    call: async (method, payload) => { hostCalls.push({ method, payload }); return { ok: true, ...hostBalance }; },
    t: key => key,
    singleFlight: fn => fn,
    window: { setInterval: () => 1, clearInterval: () => {} },
    fetch: async url => url.endsWith('/api/account-usage/opencode')
      ? { status: 404, json: async () => ({ ok: false }) }
      : summary,
    __DSH_BOOT__: { release: { version: '0.2.2-rc.1' } },
  });
  vm.runInContext(pollSnippet, context);
  await settled();
  await settled();
  return { balance: balanceValue, hostCalls };
}

test('account-usage 路由 404 时回退 host 官方账户：余额仍展示且带客户端元信息', async () => {
  const result = await pollBalance({
    summary: { status: 404, json: async () => ({ ok: false }) },
    hostBalance: { available: true, currency: 'CNY', toppedUp: 2.31, granted: 0.01, total: 2.32 },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result.balance)), { available: true, data: { toppedUp: 2.31, granted: 0.01, currency: 'CNY' }, error: null });
  assert.equal(result.hostCalls.length, 1);
  assert.equal(result.hostCalls[0].method, 'usage/account');
  assert.deepEqual(
    { version: result.hostCalls[0].payload.version, locale: result.hostCalls[0].payload.locale, timezoneOffsetSeconds: typeof result.hostCalls[0].payload.timezoneOffsetSeconds },
    { version: '0.2.2-rc.1', locale: 'zh-CN', timezoneOffsetSeconds: 'number' },
  );
});

test('account-usage 可用时不请求 host；未配置 token 时也回退官方余额', async () => {
  const direct = await pollBalance({
    summary: { status: 200, json: async () => ({ ok: true, balance: { toppedUp: 5, granted: 0, currency: 'CNY' } }) },
    hostBalance: { available: true },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(direct.balance)), { available: true, data: { toppedUp: 5, granted: 0, currency: 'CNY' }, error: null });
  assert.equal(direct.hostCalls.length, 0);

  const noToken = await pollBalance({
    summary: { status: 200, json: async () => ({ ok: false, code: 'no-token' }) },
    hostBalance: { available: true, currency: 'CNY', toppedUp: 3, granted: 0, total: 3 },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(noToken.balance)), { available: true, data: { toppedUp: 3, granted: 0, currency: 'CNY' }, error: null });
  assert.equal(noToken.hostCalls.length, 1);
});

test('host 也无余额（未登录）时显示 — 而非旧数据', async () => {
  const result = await pollBalance({
    summary: { status: 404, json: async () => ({ ok: false }) },
    hostBalance: { available: false, reason: 'signed-out' },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result.balance)), { available: false, data: null, error: null });
});
