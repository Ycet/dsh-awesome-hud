import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { resolveChangesReview } from '../lib/index.js';

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const clip = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));

test('HUD 面板上下滑动不展示滚动条（v0.17.0）', () => {
  // scrollbar-width:none + WebKit 滚动条宽度 0；旧的「滚动时显示、停止后渐隐」逻辑必须移除，
  // 否则 scrollbar-width:thin 会重新占用 6px 并出现可见滑块。
  assert.match(source, /\.hud-panel-body\{[^}]*scrollbar-width:none/);
  assert.match(source, /\.hud-panel-body::-webkit-scrollbar\{width:0;height:0;display:none\}/);
  assert.doesNotMatch(source, /data-scrolling|data-fading|onPanelScroll/);
  assert.match(source, /className: "hud-panel-body", ref: bodyRef \}/);
});

test('文件行左键先开官方「第 N 轮改动」review，再回退 diff tab；右键弹原菜单（v0.17.0）', () => {
  // 左键不再走 openFileMenu；右键才 preventDefault 并打开菜单。
  // v0.20.0：renderFileRow 改为块级函数（先拆文件名 / 相对目录，再渲染按钮）。
  assert.match(source, /const renderFileRow = \(file, group\) => \{/);
  assert.match(source, /const parts = splitRelativePath\(file\.path\);/);
  assert.match(source, /onClick: \(\) => openFileDiff\(file, group\)/);
  assert.match(source, /onContextMenu: \(event\) => \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*openFileMenu\(event, file, group\);/s);
  assert.doesNotMatch(source, /title: file\.path/);
  // 文件行必须带可访问名（原生 title 被自定义提示取代后仍能被读屏识别）。
  assert.match(source, /"aria-label": file\.path/);
  // 右键菜单仍可用键盘打开：Shift+F10 / 菜单键。
  assert.match(source, /event\.key !== "ContextMenu" && !\(event\.shiftKey && event\.key === "F10"\)/);
  assert.match(source, /openFileMenu\(event, file, group\);/);

  // 官方 review（第 N 轮改动）优先；官方侧栏不可用/最新一轮没有该文件时才回退 diff tab。
  const official = source.indexOf('call("git/changes-review"');
  const fallback = source.indexOf('openGitFileDiff(props.sessionId, file, group)');
  assert.ok(official > 0 && fallback > official, '官方 review 必须排在 better-sidebar 回退之前');
  assert.match(source, /sidebarRight\.openResource\(review\.address, \{ params: \{ index: review\.index \} \}\)/);
});

test('悬停文件行 0.5s 后在鼠标位置显示完整路径（v0.17.0）', () => {
  assert.match(source, /onMouseEnter: \(event\) => scheduleFileTip\(event, file\.path\)/);
  assert.match(source, /onMouseMove: \(event\) => \{ fileTipPosRef\.current = \{ x: event\.clientX, y: event\.clientY \}; \}/);
  assert.match(source, /onMouseLeave: cancelFileTip/);
  assert.match(source, /\}, 500\);/);
  // git graph 提交记录的悬停提示同样统一为 0.5s。
  assert.match(source, /const hoverTip = \(event, commit\) => \{[\s\S]*?\}, 500\);/);
  assert.match(source, /className: "hud-file-tip"/);
  assert.match(source, /role: "tooltip"/);
  // 滚动/缩放时隐藏，避免提示停在已经移走的行上方。
  assert.match(source, /window\.addEventListener\("scroll", hide, true\)/);
});

test('git graph 悬停提示：提交带分支/标签时一并展示（v0.17.0）', () => {
  // 行内标签与悬停提示共用同一个「可见引用」过滤器（排除 HEAD 符号引用）。
  assert.match(source, /function visibleCommitRefs\(commit\) {/);
  assert.match(source, /const refs = visibleCommitRefs\(commit\);/);
  assert.match(source, /const tipRefs = tip === null \? \[\] : visibleCommitRefs\(tip\.commit\);/);
  assert.match(source, /className: "hud-git-tip-refs"/);
  assert.match(source, /className: "hud-git-ref hud-git-tip-ref"/);
  assert.match(source, /ref\.kind === "branch" \? react\.createElement\(BranchIcon, \{ size: 11 \}\) : null/);
  assert.match(source, /\.hud-git-tip-refs\{display:flex;flex-wrap:wrap/);
  // aria-label 也带上分支/标签，读屏与视觉提示一致。
  assert.match(source, /refs\.map\(\(ref\) => ref\.text\)\.join\(" · "\)/);
});

test('diff tab seed 与 better-sidebar 的 id/内容约定一致（v0.17.0 回归）', () => {
  const context = vm.createContext({});
  vm.runInContext(clip('function buildGitDiffTab', 'function GitModule'), context);

  const changed = JSON.parse(JSON.stringify(context.buildGitDiffTab({ path: 'dsh-awesome-hud/README_en.md', status: 'M' }, 'changes')));
  assert.deepEqual(changed, {
    type: 'diff',
    id: 'diff:w::u:dsh-awesome-hud/README_en.md',
    title: 'README_en.md',
    diff: { kind: 'worktree', path: 'dsh-awesome-hud/README_en.md', staged: false },
  });

  const staged = JSON.parse(JSON.stringify(context.buildGitDiffTab({ path: 'src/a.ts', status: 'M' }, 'staged')));
  assert.equal(staged.id, 'diff:w::s:src/a.ts');
  assert.equal(staged.diff.staged, true);
  assert.equal(staged.title, 'a.ts');

  // 未跟踪文件：git diff 永远为空，必须带 untracked 让查看器走全文件新增兜底。
  const untracked = JSON.parse(JSON.stringify(context.buildGitDiffTab({ path: '月累+实时家电销售岗数据通报 10月全月.xlsx', status: '?' }, 'changes')));
  assert.equal(untracked.diff.untracked, true);
  assert.equal(untracked.diff.staged, false);

  // git add -N 的预登记文件（porcelain ` A`）同样没有普通 diff，按全文件新增读取。
  const intent = JSON.parse(JSON.stringify(context.buildGitDiffTab({ path: 'new.ts', status: 'A', intentToAdd: true }, 'changes')));
  assert.equal(intent.diff.untracked, true);
  assert.equal(intent.diff.staged, false);
});

test('openGitFileDiff 交给 betterSidebar.openTab；未安装时返回 false 而不是抛错（v0.17.0）', () => {
  const calls = [];
  const sidebar = { openTab: (seed, scope) => calls.push([seed, scope]) };
  const withSidebar = vm.createContext({ ctx: { get: name => name === 'betterSidebar' ? sidebar : undefined } });
  vm.runInContext(clip('function buildGitDiffTab', 'function GitModule'), withSidebar);
  assert.equal(withSidebar.openGitFileDiff('session-1', { path: 'a/b.ts', status: 'M' }, 'changes'), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].type, 'diff');
  assert.equal(calls[0][0].diff.path, 'a/b.ts');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])), { sessionId: 'session-1' });

  // 有会话 cwd 时随 scope 传给 better-sidebar，供未跟踪文件的全文件读取兜底。
  const withCwd = vm.createContext({ ctx: { get: name => name === 'betterSidebar'
    ? { openTab: (seed, scope) => calls.push([seed, scope]) }
    : name === 'sessions' ? { list: { getSnapshot: () => ({ byId: { 'session-1': { cwd: '/workspace/repo' } } }) } } : undefined } });
  vm.runInContext(clip('function buildGitDiffTab', 'function GitModule'), withCwd);
  assert.equal(withCwd.openGitFileDiff('session-1', { path: 'a/b.ts', status: 'M' }, 'changes'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1)[1])), { sessionId: 'session-1', cwd: '/workspace/repo' });

  const missing = vm.createContext({ ctx: { get: () => undefined } });
  vm.runInContext(clip('function buildGitDiffTab', 'function GitModule'), missing);
  assert.equal(missing.openGitFileDiff('session-1', { path: 'a/b.ts', status: 'M' }, 'changes'), false);
});

test('diff 打开失败有中英文可读提示（v0.17.0）', () => {
  assert.match(source, /gitDiffUnavailable: "无法打开右侧 git diff：需要安装并启用 dsh-better-sidebar"/);
  assert.match(source, /gitDiffOpenFailed: "打开 git diff 失败：\{detail\}"/);
  assert.match(source, /gitDiffUnavailable: "Cannot open the git diff in the right sidebar: install and enable dsh-better-sidebar"/);
  assert.match(source, /gitDiffOpenFailed: "Failed to open the git diff: \{detail\}"/);
  assert.match(source, /toast\(t\("gitDiffUnavailable"\)\)/);
  assert.match(source, /toast\(interpolate\(t\("gitDiffOpenFailed"\), \{ detail: error\?\.message \?\? String\(error\) \}\)\)/);
});

test('官方「第 N 轮改动」review 坐标：最新轮命中、唯一 basename、旧轮不冒充（v0.17.0）', () => {
  const events = [
    { type: 'workspace/changes', seq: 10, data: { turn: 1 } },
    { type: 'tool/result', seq: 11 },
    { type: 'workspace/changes', seq: 20, data: { turn: 2 } },
  ];
  const summaries = {
    10: { turn: 1, files: [{ path: 'old-file.ts', display: 'old-file.ts' }] },
    20: { turn: 2, files: [
      { path: 'dsh-awesome-hud/README_en.md', display: 'dsh-awesome-hud/README_en.md' },
      { path: 'src/a.ts', display: 'src/a.ts' },
    ] },
  };
  const summaryFor = seq => summaries[seq];

  const exact = resolveChangesReview(events, summaryFor, 'session/1', 'dsh-awesome-hud/README_en.md');
  assert.deepEqual(exact, {
    address: 'dsh-resource://changes-review/session/session%2F1/20/2',
    index: 0,
    seq: 20,
    turn: 2,
  });
  // display 路径与唯一 basename 兜底（HUD 路径相对仓库根、摘要路径相对会话 cwd）。
  assert.equal(resolveChangesReview(events, summaryFor, 's', 'src/a.ts').index, 1);
  assert.equal(resolveChangesReview(events, summaryFor, 's', 'README_en.md').index, 0);

  // 最新一轮没有该文件时不能翻旧轮次：旧轮快照可能已不是当前工作树内容。
  assert.equal(resolveChangesReview(events, summaryFor, 's', 'old-file.ts'), null);
  // 同名多文件时不猜测。
  const ambiguous = { 20: { turn: 2, files: [{ path: 'a/x.ts' }, { path: 'b/x.ts' }] } };
  assert.equal(resolveChangesReview(events, seq => ambiguous[seq], 's', 'x.ts'), null);
  // 摘要被释放/服务缺失、无 workspace/changes 事件、非法轮号。
  assert.equal(resolveChangesReview(events, () => undefined, 's', 'src/a.ts'), null);
  assert.equal(resolveChangesReview([{ type: 'tool/result', seq: 1 }], summaryFor, 's', 'src/a.ts'), null);
  assert.equal(resolveChangesReview([{ type: 'workspace/changes', seq: 30, data: { turn: 0 } }], () => ({ turn: 0, files: [{ path: 'src/a.ts' }] }), 's', 'src/a.ts'), null);
});
