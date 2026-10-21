import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

export const browserAvailable = Boolean(process.env.HUD_TEST_RUNTIME && process.env.HUD_TEST_PLAYWRIGHT);

// 用桌面运行时的真实 React 执行完整 HUD；叶子模块只记录收到的数据，避免依赖宿主 DOM。
// 请求均在夹具中排队，不启动真实 Host、不访问账户，也不操作用户的浏览器。
export async function browserHarness(options = {}) {
  const assets = join(process.env.HUD_TEST_RUNTIME, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets');
  const entry = readdirSync(assets).find(name => /^index-.*\.js$/.test(name));
  let frontend = readFileSync(join(assets, entry), 'utf8');
  const boot = frontend.indexOf('const fo=globalThis.dshDesktopBoot');
  if (boot < 0 || !frontend.includes('function rM()')) throw new Error('官方前端测试入口已变化，请重新核对运行时');
  frontend = frontend.slice(0, boot) + '\nwindow.testBuiltins=rM();';
  const client = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8');
  const { chromium } = createRequire(import.meta.url)(process.env.HUD_TEST_PLAYWRIGHT);
  const browser = await chromium.launch({ headless: true,
    ...(process.env.HUD_TEST_BROWSER ? { executablePath: process.env.HUD_TEST_BROWSER } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    if (name === 'frontend.js') return route.fulfill({ contentType: 'text/javascript', body: frontend });
    if (/^vendor-.*\.js$/.test(name)) return route.fulfill({ contentType: 'text/javascript', body: readFileSync(join(assets, name), 'utf8') });
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head></head><body><div id="test-root"></div></body></html>' });
  });
  await page.goto('http://hud.test/');
  await page.addScriptTag({ type: 'module', url: 'http://hud.test/frontend.js' });
  await page.waitForFunction(() => window.testBuiltins);
  await page.evaluate(({ client, options }) => {
    const builtins = window.testBuiltins, React = builtins.react, h = React.createElement;
    const traces = [], commits = [], propsByModule = new Map();
    const probes = new Map(['SessionModule', 'ContextModule', 'BalanceModule', 'GitModule', 'SubagentsModule',
      'TasksModule', 'PlansModule', 'McpModule', 'NoteModule', 'TodoModule', 'ModulePlaceholder'].map(name => [name,
      props => h('section', { 'data-module': name === 'ModulePlaceholder' ? `loading:${props.module}` : name }, JSON.stringify(props))]));
    const react = { ...React, createElement(type, props, ...children) {
      if (!options.realModules && probes.has(type?.name)) {
        traces.push({ name: type.name, props }); propsByModule.set(type.name, props);
        return h(probes.get(type.name), props, ...children);
      }
      return h(type, props, ...children);
    } };
    window.__ModuleLoader__ = { load: definition => { window.plugin = definition.factory(name => name === 'react' ? react : builtins[name]); } };
    (0, eval)(client);
    const store = value => {
      const listeners = new Set();
      return { getSnapshot: () => value, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
        set(next) { value = next; for (const fn of listeners) fn(); } };
    };
    const byId = Object.fromEntries(['A', 'A2', 'B'].map(id => [id, { id, cwd: id === 'B' ? '/b' : '/a', title: id,
      projectionValues: { todos: [{ content: `${id} task`, status: 'pending' }] } }]));
    const sessions = store({ current: 'A', byId });
    const binding = store({ key: 'A' });
    const directories = new Map(['A', 'A2', 'B'].map(id => [id, store({ current: { provider: id, model: `${id}-model` }, groups: [] })]));
    const slots = new Map(), disposers = [], intervals = new Map();
    let timerId = 0;
    window.setInterval = (fn, ms) => { const id = ++timerId; intervals.set(id, { fn, ms }); return id; };
    window.clearInterval = id => intervals.delete(id);
    const requests = [];
    window.fetch = (url, init) => {
      const method = new URL(url).pathname.split('/').pop();
      if (url.includes('/assets/')) return Promise.resolve({ ok: true, text: async () => '<svg />' });
      return new Promise((resolve, reject) => requests.push({ method, payload: JSON.parse(init?.body ?? '{}'), done: false,
        resolve(body, status = 200) { this.done = true; resolve({ ok: status >= 200 && status < 300, status, json: async () => body }); },
        reject(error) { this.done = true; reject(new Error(error)); } }));
    };
    const ctx = {
      sessions: { list: sessions }, uiSession: { adapter: { current: binding } },
      workspaces: { list: store({ items: [{ path: '/a', title: 'A workspace', sessionIds: ['A', 'A2'] }, { path: '/b', title: 'B workspace', sessionIds: ['B'] }] }) },
      modelDirectories: { directoryFor: id => ({ store: directories.get(id) }) },
      get(name) { return ctx[name]; }, locale: { register() {}, bind: () => key => key },
      effect(fn, label) { if (/styles|dictionaries/.test(label)) { const cleanup = fn(); if (cleanup) disposers.push(cleanup); } },
      slots: { inject(_name, fn) { fn(); }, register(meta, Component) { slots.set(meta.name, Component); } },
    };
    for (const [key, value] of Object.entries(options.storage ?? {})) localStorage.setItem(key, value);
    window.plugin.apply(ctx);
    const root = builtins['react-dom/client'].createRoot(document.getElementById('test-root'));
    const Component = slots.get('shell.overlay');
    // 官方生产 React 不启用 Profiler 回调；在 slot 的布局 effect 中记录每次提交。
    function RootProbe(props) {
      const tree = Component(props);
      React.useLayoutEffect(() => { commits.push([...document.querySelectorAll('[data-module]')].map(el => el.dataset.module)); });
      return tree;
    }
    const render = show => builtins['react-dom'].flushSync(() => root.render(show ? h(RootProbe, { usePanelInfo: fn => fn({ activePanelId: null }) }) : null));
    window.fixture = {
      requests, traces, commits, propsByModule, intervals, ctx,
      render, switchTo(id) { traces.length = 0; commits.length = 0; builtins['react-dom'].flushSync(() => binding.set({ key: id })); },
      resolve(method, sessionId, body) { const request = requests.find(r => !r.done && r.method === method && (sessionId === undefined || r.payload.sessionId === sessionId));
        if (!request) throw new Error(`没有排队请求：${method}/${sessionId}`); request.resolve(body); },
      reject(method, sessionId) { requests.find(r => !r.done && r.method === method && r.payload.sessionId === sessionId).reject('offline'); },
      poll(ms = 5000) { for (const timer of [...intervals.values()]) if (timer.ms === ms) timer.fn(); },
      mutateGit(snapshot) { builtins['react-dom'].flushSync(() => propsByModule.get('GitModule').onGit(snapshot)); },
      modules() { return [...document.querySelectorAll('[data-module]')].map(el => [el.dataset.module, JSON.parse(el.textContent)]); },
      first(name) { return traces.find(trace => trace.name === name)?.props; },
      unmount() { render(false); for (const dispose of disposers.reverse()) dispose(); },
    };
    render(true);
  }, { client, options });
  return { page, errors, close: () => browser.close() };
}
