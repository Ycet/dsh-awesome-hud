// dsh-awesome-hud — Git 模块客户端链路回归
//
// 客户端 bundle 的交互状态依赖真实 React 重渲染，这里沿用仓库既有做法：从 bundle 中
// 抽取处理函数，在桩环境里运行，断言「发出哪些请求、带什么参数、给出什么提示」。
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { clientSource, extractArrowHandler, extractFunction as extractRaw } from './helpers/client-harness.mjs';

/** 通用桩环境：记录 call / toast / onGit，并提供处理器需要的闭包变量。 */
function createStub(extra = {}) {
  const calls = [];
  const toasts = [];
  const context = vm.createContext({
    call: async (method, payload) => {
      calls.push({ method, payload });
      const failure = context.__failure;
      if (failure !== null) throw Object.assign(new Error(failure.message ?? 'upstream error'), failure);
      return { ok: true, ...(context.__response ?? {}) };
    },
    props: {
      sessionId: 'session',
      git: { branch: 'main', files: [] },
      onGit: (snapshot) => calls.push({ method: '__onGit', payload: snapshot }),
      ...(extra.props ?? {}),
    },
    toast: (text, kind) => toasts.push({ text, kind }),
    interpolate: (text, values) => Object.entries(values ?? {}).reduce((next, [key, value]) => next.replace(`{${key}}`, String(value)), text),
    // 保留占位符，便于断言提示里的文件清单 / 错误原因
    t: (key) => ({
      gitBranchConflict: '切换分支失败：{files}',
      gitMergeConflict: '合并冲突，已自动回滚：{files}',
      gitInitDone: '已初始化 git 仓库',
      gitInitFailed: '初始化仓库失败：{detail}',
      gitOperationFailed: '操作失败：{detail}',
      gitBranchSwitched: '已切换到分支「{branch}」',
      gitBranchFailed: '切换分支失败：{detail}',
      gitBranchAlreadyOn: '当前已在分支「{branch}」',
    }[key] ?? key),
    __failure: null,
    __response: extra.response ?? {},
    __calls: calls,
    ...extra.globals,
  });
  return { context, calls, toasts };
}

const loadHandler = (context, name, extraPrelude = '') => {
  vm.runInContext(`${extraPrelude}\n${extractArrowHandler(name)}\nthis.handler = ${name};`, context);
  return context.handler;
};

/** vm 内创建的对象来自另一个 realm：比较前归一化为宿主对象。 */
const plain = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const recorded = (calls, method) => calls.filter((call) => call.method === method).map((call) => plain(call.payload));

test('切换分支：发送 git/checkout 并带上目标分支，成功后刷新快照并提示', async () => {
  const { context, calls, toasts } = createStub({
    response: { branch: 'dev', isRepo: true },
    globals: { closeBranchMenu: () => calls.push({ method: '__close' }), setBranchBusy: (value) => calls.push({ method: '__busy', payload: value }) },
  });
  const switchBranch = loadHandler(context, 'switchBranch', 'let branchBusy = null;');

  await switchBranch('dev');
  const checkout = calls.find((call) => call.method === 'git/checkout');
  assert.deepEqual(plain(checkout.payload), { sessionId: 'session', branch: 'dev' });
  assert.equal(calls.some((call) => call.method === '__onGit'), true, '成功后必须把新快照交给父组件刷新界面');
  assert.deepEqual(plain(toasts), [{ text: '已切换到分支「dev」', kind: 'success' }]);
  assert.equal(calls.some((call) => call.method === '__close'), true, '完成后关闭菜单');
  assert.deepEqual(recorded(calls, '__busy'), ['dev', null]);
});

test('切换分支：点击当前分支短路，只给出「已在当前分支」提示', async () => {
  const { context, calls, toasts } = createStub({ globals: { closeBranchMenu: () => calls.push({ method: '__close' }), setBranchBusy: () => {} } });
  const switchBranch = loadHandler(context, 'switchBranch', 'let branchBusy = null;');
  await switchBranch('main');
  assert.equal(calls.some((call) => call.method === 'git/checkout'), false, '当前分支不得发切换请求');
  assert.equal(calls.filter((call) => call.method === '__close').length, 1, '仍需关闭菜单');
  assert.equal(toasts.length, 1, '不再静默：必须给出反馈');
  assert.match(toasts[0].text, /main/);
  assert.equal(toasts[0].kind, undefined, '属信息提示，不是错误');
});

test('call()：把 host 回传的冲突文件清单透传到 error 上', async () => {
  const context = vm.createContext({
    PREFIX: '/awesome-hud/api',
    hostBase: () => '',
    fetch: async () => ({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: '本地修改将被切换覆盖：docs/a.md', code: 'local-changes-conflict', files: ['docs/a.md'] }),
    }),
  });
  vm.runInContext(`${extractRaw("call")}
this.call = call;`, context);
  const error = await context.call('git/checkout', { sessionId: 's', branch: 'dev' }).catch((failure) => failure);
  assert.equal(error.code, 'local-changes-conflict');
  assert.deepEqual(plain(error.files), ['docs/a.md'], '提示文案需要文件清单');
});

test('切换分支失败：冲突给出文件清单提示，其它错误给出原因', async () => {
  const conflict = createStub({
    globals: { closeBranchMenu: () => {}, setBranchBusy: () => {} },
  });
  conflict.context.__failure = { code: 'local-changes-conflict', files: ['docs/a.md'], message: '本地修改将被切换覆盖' };
  const switchConflict = loadHandler(conflict.context, 'switchBranch', 'let branchBusy = null;');
  await switchConflict('dev');
  assert.equal(conflict.toasts.length, 1);
  assert.equal(conflict.toasts[0].kind, 'warn');
  assert.match(conflict.toasts[0].text, /docs\/a\.md/, '冲突提示必须列出文件');

  const other = createStub({ globals: { closeBranchMenu: () => {}, setBranchBusy: () => {} } });
  other.context.__failure = { message: '未找到分支「nope」' };
  const switchOther = loadHandler(other.context, 'switchBranch', 'let branchBusy = null;');
  await switchOther('nope');
  assert.equal(other.toasts[0].kind, 'error');
  assert.match(other.toasts[0].text, /未找到分支/);
});

test('初始化仓库：发送 git/init 并刷新快照，失败时提示原因且恢复可点击', async () => {
  const ok = createStub({ response: { isRepo: true, branch: 'main' }, globals: { setInitBusy: (value) => ok.calls.push({ method: '__busy', payload: value }) } });
  const initRepo = loadHandler(ok.context, 'initRepo', 'let initBusy = false;');
  await initRepo({ stopPropagation() {} });
  assert.deepEqual(plain(ok.calls.find((call) => call.method === 'git/init').payload), { sessionId: 'session' });
  assert.equal(ok.calls.some((call) => call.method === '__onGit'), true);
  assert.deepEqual(plain(ok.toasts), [{ text: '已初始化 git 仓库', kind: 'success' }]);

  const failed = createStub({ globals: { setInitBusy: (value) => failed.calls.push({ method: '__busy', payload: value }) } });
  failed.context.__failure = { message: 'fatal: could not create directory' };
  const initFailed = loadHandler(failed.context, 'initRepo', 'let initBusy = false;');
  await initFailed({ stopPropagation() {} });
  assert.equal(failed.toasts[0].kind, 'error');
  assert.match(failed.toasts[0].text, /could not create directory/);
  assert.deepEqual(recorded(failed.calls, '__busy'), [true, false], '失败后必须恢复按钮可点击');
});

test('文件操作：stage / unstage / revert 的请求参数与成功提示', async () => {
  const runWriteStub = 'const runWrite = (method, extra, onOk) => { __run.push({ method, extra }); if (onOk !== undefined) onOk({}); };';
  const { context, calls } = createStub({ globals: { __run: [] } });
  vm.runInContext(runWriteStub, context);
  const setMenu = () => calls.push({ method: '__setMenu' });
  context.setMenu = setMenu;

  const doStage = loadHandler(context, 'doStage');
  doStage({ path: 'docs/a.md' });
  const doUnstage = loadHandler(context, 'doUnstage');
  doUnstage({ path: 'docs/a.md' });

  context.changesFiles = [];
  context.stagedFiles = [];
  const doStageAll = loadHandler(context, 'doStageAll');
  const doUnstageAll = loadHandler(context, 'doUnstageAll');
  doStageAll();
  doUnstageAll();

  assert.deepEqual(plain(context.__run.map((entry) => [entry.method, entry.extra])), [
    ['git/stage', { path: 'docs/a.md' }],
    ['git/unstage', { path: 'docs/a.md' }],
  ], '空分组时 stage-all / unstage-all 不应发请求');

  context.changesFiles = [1, 2];
  context.stagedFiles = [1];
  doStageAll();
  doUnstageAll();
  assert.deepEqual(plain(context.__run.slice(2).map((entry) => [entry.method, entry.extra])), [
    ['git/stage-all', {}],
    ['git/unstage-all', {}],
  ]);

  // revert：单文件与全部走同一确认流程，参数分别带路径 / 空对象
  const confirmStub = 'let confirm = null;';
  const revertContext = createStub({ globals: { __run: [], setConfirm: () => {} } });
  vm.runInContext(runWriteStub, revertContext.context);
  const confirmRevertHandler = loadHandler(revertContext.context, 'confirmRevert', confirmStub);
  const setConfirm = (value) => vm.runInContext(`confirm = ${JSON.stringify(value)};`, revertContext.context);
  setConfirm({ kind: 'revert-file', file: { path: 'docs/a.md' } });
  confirmRevertHandler();
  assert.deepEqual(plain(revertContext.context.__run.map((entry) => [entry.method, entry.extra])), [['git/revert-file', { path: 'docs/a.md' }]]);
  setConfirm({ kind: 'revert-all', files: [{ path: 'a' }, { path: 'b' }] });
  confirmRevertHandler();
  assert.deepEqual(plain(revertContext.context.__run.slice(1).map((entry) => [entry.method, entry.extra])), [['git/revert-all', {}]]);
});

test('分支菜单：当前分支勾选，点击行调用切换；空列表给出提示', () => {
  // 行：hud-git-menu-item + data-current + 勾选标记 + 分支名；点击调用 switchBranch(name)
  assert.match(clientSource, /className: "hud-git-menu-item",\s*\n\s*"data-current": current,/);
  assert.match(clientSource, /react\.createElement\("span", \{ className: "hud-branch-check" \}, current \? "\\u2713" : ""\)/);
  assert.match(clientSource, /onClick: \(event\) => \{ event\.stopPropagation\(\); switchBranch\(name\); \},/);
  assert.match(clientSource, /className: "hud-branch-note" \}, t\("gitBranchEmpty"\)\)/);
  // 标题栏按钮渲染当前分支名，非仓库时换成「初始化仓库」
  assert.match(clientSource, /className: "hud-btn-small hud-git-btn hud-branch-switch",/);
  assert.match(clientSource, /react\.createElement\(Icon, \{ name: "git-branch", size: 13 \}\),\s*\n\s*react\.createElement\("span", null, props\.git\.branch\)\)\)/);
});
