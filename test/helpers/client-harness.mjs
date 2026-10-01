import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8');

// 执行完整客户端 bundle，保留真实的 slot 组件、请求、共享快照和存储逻辑。
// React 适配器仅记录元素与 effect；测试手动重渲染，避免依赖桌面进程或网络。
export function hudClient({ state = { byId: {} }, workspaces = [], current, windows = false, fullscreen = false,
  storage = {}, respond = () => ({ ok: true, servers: [], total: 0, enabled: 0, isRepo: true }) } = {}) {
  const effects = [], styles = [], calls = [], slots = new Map(), intervals = new Map(), domListeners = new Set();
  let sidebarEffect;
  const persisted = new Map(Object.entries(storage));
  const store = value => ({ getSnapshot: () => value, subscribe: () => () => {} });
  const services = { sessions: { list: store(state) }, workspaces: { list: store({ items: workspaces }) },
    uiSession: { adapter: { current: store({ key: current }) } } };
  const react = {
    Component: class {}, Fragment: 'fragment',
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: init => { let value = typeof init === 'function' ? init() : init; return [value, next => { value = typeof next === 'function' ? next(value) : next; }]; },
    useRef: value => ({ current: value }), useMemo: fn => fn(), useCallback: fn => fn,
    useEffect: fn => effects.push(fn),
  };
  const ctx = {
    get: key => services[key], uiSession: services.uiSession,
    locale: { register() {}, bind: () => key => key },
    effect: (fn, label) => {
      if (/styles|dictionaries/.test(label)) fn();
      if (label?.includes('sidebar watcher')) sidebarEffect = fn;
    },
    slots: { inject: (name, fn) => fn(), register: (meta, Component) => slots.set(meta.name, Component) },
  };
  const document = {
    createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild: tag => styles.push(tag.textContent) },
    querySelectorAll: () => [], querySelector: () => null, body: {},
    documentElement: { hasAttribute: name => name === 'data-windows-titlebar' ? windows : name === 'data-fullscreen' && fullscreen },
  };
  const window = {
    __ModuleLoader__: { load: ({ factory }) => { window.plugin = factory(name => name === 'react' ? react : {}); } },
    innerWidth: 1280, innerHeight: 800, setTimeout, clearTimeout,
    setInterval: fn => { const id = intervals.size + 1; intervals.set(id, fn); return id; }, clearInterval: id => intervals.delete(id),
    getComputedStyle: () => ({ getPropertyValue: name => name === '--dsh-windows-titlebar-height' ? '40px' : fullscreen ? '0px' : '40px' }),
  };
  vm.runInNewContext(source, {
    window, document, URLSearchParams, setTimeout, clearTimeout,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() { domListeners.add(this.callback); }
      disconnect() { domListeners.delete(this.callback); }
    },
    localStorage: { getItem: key => persisted.get(key) ?? null, setItem: (key, value) => persisted.set(key, value) },
    fetch: async (url, init) => {
      const call = { url, payload: JSON.parse(init?.body ?? '{}') }; calls.push(call);
      const body = await respond(call);
      return { ok: true, json: async () => body };
    },
  });
  window.plugin.apply(ctx);
  const root = () => slots.get('shell.overlay')({ usePanelInfo: fn => fn({ activePanelId: null }) });
  const button = () => nodes(root()).find(node => node?.type?.name === 'HudFloatingButton')?.type();
  const panel = () => {
    const element = nodes(root()).find(node => node?.type?.name === 'HudPanel');
    if (!element) throw new Error('HUD panel is closed');
    effects.length = 0;
    return element.type(element.props);
  };
  return { styles, calls, effects, intervals, services, persisted, root, button, panel,
    runPolls: () => effects.filter(fn => /call\("(?:git|mcp)"/.test(String(fn))).map(fn => fn()),
    startSidebarWatcher: () => sidebarEffect(), notifyDOM: () => { for (const listener of domListeners) listener(); },
  };
}

export function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...(node.children ?? []).flat(Infinity).flatMap(nodes)];
}
export function moduleOf(panel, name) { return nodes(panel).find(node => node.type?.name === name); }
export const settled = () => new Promise(resolve => setImmediate(resolve));
