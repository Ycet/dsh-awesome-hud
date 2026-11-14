import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8');

// 执行完整客户端 bundle，保留真实的 slot 组件、请求、共享快照和存储逻辑。
// React 适配器仅记录元素与 effect；测试手动重渲染，避免依赖桌面进程或网络。
export function hudClient({ state = { byId: {} }, workspaces = [], pinnedSessions = [], current, windows = false, fullscreen = false,
  storage = {}, workspaceApi = {}, extraServices = {}, primitives = null, querySelector = () => null,
  // v0.19.0：便笺图片走 IndexedDB / URL.createObjectURL，测试可按需注入这两个平台对象。
  globals = {},
  respond = () => ({ ok: true, servers: [], total: 0, enabled: 0, isRepo: true }) } = {}) {
  const effects = [], styles = [], calls = [], slots = new Map(), intervals = new Map(), domListeners = new Set();
  // v0.19.0：同一 slot 可能有多个注册（如会话头部的 HUD 按钮 + 展示方式按钮），
  // slots 仍按「后注册覆盖」保留旧语义，另用 slotEntries 保留全部注册供断言。
  const slotEntries = [];
  // v0.18.5：捕获 register 传入的中英字典，供「文案键齐全」类断言使用。
  const dictionaries = [];
  let sidebarEffect;
  const persisted = new Map(Object.entries(storage));
  const store = value => ({ getSnapshot: () => value, subscribe: () => () => {} });
  // 主视图绑定与列表快照分开持有：测试可用 setSession 模拟「新建页 → 真实会话」切换。
  const binding = { key: current };
  // pinnedSessions 供会话置顶标记断言使用；workspaceApi 覆盖 workspaces 服务方法（默认提供 rename 桩）；
  // extraServices 让测试注入 uiWorkspace 等官方客户端服务。
  const workspaceStore = store({ items: workspaces, pinnedSessionIds: pinnedSessions });
  const services = { sessions: { list: store(state) },
    workspaces: { list: workspaceStore, rename: async () => ({}), pinSession: async () => {}, unpinSession: async () => {}, ...workspaceApi },
    uiSession: { adapter: { current: store(binding) } }, ...extraServices };
  const react = {
    Component: class {}, Fragment: 'fragment',
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: init => { let value = typeof init === 'function' ? init() : init; return [value, next => { value = typeof next === 'function' ? next(value) : next; }]; },
    useRef: value => ({ current: value }), useMemo: fn => fn(), useCallback: fn => fn,
    useEffect: fn => effects.push(fn),
  };
  const ctx = {
    get: key => services[key], uiSession: services.uiSession,
    locale: { register: (ns, dicts) => { dictionaries.push(dicts); }, bind: () => key => key },
    effect: (fn, label) => {
      if (/styles|dictionaries/.test(label)) fn();
      if (label?.includes('sidebar watcher')) sidebarEffect = fn;
    },
    slots: {
      inject: (name, fn) => fn(),
      register: (meta, Component) => { slotEntries.push({ meta, Component }); slots.set(meta.name, Component); },
    },
  };
  const document = {
    createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild: tag => styles.push(tag.textContent) },
    querySelectorAll: () => [], querySelector, body: {},
    // 让位 effect 会往 documentElement 写自有 CSS 变量；这里给出最小 style 桩。
    documentElement: {
      style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
      hasAttribute: name => name === 'data-windows-titlebar' ? windows : name === 'data-fullscreen' && fullscreen,
    },
  };
  const window = {
    // v0.18.2：primitives 可注入（默认空对象 → 客户端走本地回退控件）。
    __ModuleLoader__: { load: ({ factory }) => { window.plugin = factory(name => name === 'react' ? react : name === 'react-dom' ? reactDom : name === '@deepseek-ai/dsh-client-ui-primitives' ? (primitives ?? {}) : {}); } },
    innerWidth: 1280, innerHeight: 800, setTimeout, clearTimeout,
    // v0.18.2：让位 effect 用 rAF 合并对账、用 ResizeObserver 跟踪列宽；测试只关心首次写入。
    requestAnimationFrame: fn => { setTimeout(fn, 0); return 0; }, cancelAnimationFrame: () => {},
    addEventListener() {}, removeEventListener() {},
    setInterval: fn => { const id = intervals.size + 1; intervals.set(id, fn); return id; }, clearInterval: id => intervals.delete(id),
    getComputedStyle: () => ({ getPropertyValue: name => name === '--dsh-windows-titlebar-height' ? '40px' : fullscreen ? '0px' : '40px' }),
  };
  const reactDom = { createPortal: (node) => node };
  vm.runInNewContext(source, {
    window, document, URLSearchParams, setTimeout, clearTimeout, ...globals,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() { domListeners.add(this.callback); }
      disconnect() { domListeners.delete(this.callback); }
    },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() {}
      disconnect() {}
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
  return { styles, calls, effects, intervals, services, persisted, dictionaries, root, button, panel, slotEntries,
    // 模拟「发送首条消息后进入真实会话」：同时更新列表 current 与主视图绑定。
    setSession: (id) => { state.current = id; binding.key = id; },
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

/** 按「函数声明 + 平衡大括号」从客户端 bundle 抽取一个函数/箭头函数体。 */
export function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} must exist in lib/client.js`);
  let index = source.indexOf('(', start);
  let parens = 0;
  for (; index < source.length; index += 1) {
    if (source[index] === '(') parens += 1;
    else if (source[index] === ')') { parens -= 1; if (parens === 0) break; }
  }
  index = source.indexOf('{', index);
  let depth = 0;
  for (; index < source.length; index += 1) {
    const ch = source[index];
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) return source.slice(start, index + 1); }
  }
  throw new Error(`unbalanced braces for ${name}`);
}

/** 抽取 `const <name> = async (...) => { ... };` 形式的处理器（按平衡大括号扫描）。 */
export function extractArrowHandler(name) {
  const start = source.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`handler ${name} must exist in lib/client.js`);
  const braceStart = source.indexOf('=> {', start);
  if (braceStart < 0) throw new Error(`handler ${name} is not a block arrow function`);
  let depth = 0;
  for (let index = braceStart + 3; index < source.length; index += 1) {
    const ch = source[index];
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) return source.slice(start, index + 1); }
  }
  throw new Error(`unbalanced braces for ${name}`);
}

/**
 * 抽取 `const <name> = [...]` / `const <name> = {...}` 形式的顶层常量：跳过字符串与模板字符串，
 * 按方括号/花括号平衡扫描，直到与开头括号配对（不依赖换行与缩进，避免格式化后失效）。
 */
export function extractConst(name) {
  const pattern = `const ${name} = `;
  const start = source.indexOf(pattern);
  if (start < 0) throw new Error(`const ${name} must exist in lib/client.js`);
  const bodyStart = start + pattern.length;
  const opener = source[bodyStart];
  const closer = opener === '[' ? ']' : opener === '{' ? '}' : null;
  if (closer === null) throw new Error(`const ${name} is not an array or object literal`);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const ch = source[index];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === opener) depth += 1;
    else if (ch === closer) {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unbalanced brackets for ${name}`);
}

export { source as clientSource };
