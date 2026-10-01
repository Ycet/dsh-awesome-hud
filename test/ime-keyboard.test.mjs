import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

// 执行实际客户端回调，观察提交/取消及事件默认行为，避免只检查守卫字符串是否存在。
function callbackAt(offset) {
  const start = source.indexOf('(event) =>', offset);
  assert.ok(start >= offset);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let end = brace; end < source.length; end++) {
    if (source[end] === '{') depth++;
    else if (source[end] === '}' && --depth === 0) return source.slice(start, end + 1);
  }
  throw new Error('Unclosed event callback');
}

function fixture() {
  const actions = [];
  const names = ['confirmEdit', 'cancelEdit', 'addTodo', 'commitEdit', 'createBranch',
    'cancelBranchAdd', 'cancelBranchCreate', 'closeMenu', 'closeBranchMenu', 'closeGraph',
    'cancelConfirm', 'closeCommit', 'cancelClearConfirmation', 'setClearOpen', 'setOpenId', 'openMenu'];
  const context = vm.createContext({ branchCreateOpenRef: { current: true },
    ...Object.fromEntries(names.map(name => [name, (...args) => actions.push({ name, args })])) });
  const start = source.indexOf('const composingInputs = ');
  const end = source.indexOf('const zh = ', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end) + '\nglobalThis.inputProps = IME_INPUT_PROPS;', context);
  return { context, actions, inputProps: context.inputProps,
    callback: offset => vm.runInContext('(' + callbackAt(offset) + ')', context) };
}

function keyboard(target, key = 'Enter', overrides = {}) {
  return { target, currentTarget: target, key, keyCode: key === 'Enter' ? 13 : 27,
    prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; }, ...overrides };
}

function inputHandler(f, className, occurrence = 0) {
  let offset = -1;
  for (let i = 0; i <= occurrence; i++) offset = source.indexOf(`className: "${className}"`, offset + 1);
  assert.ok(offset >= 0, className);
  offset = source.indexOf('onKeyDown:', offset);
  return f.callback(offset);
}

const submitInputs = [
  ['会话重命名', 'hud-session-edit', 0, 'confirmEdit'],
  ['添加待办', 'hud-todo-input', 0, 'addTodo'],
  ['编辑待办', 'hud-todo-edit', 0, 'commitEdit'],
  ['新建 Git 分支', 'hud-branch-add-input', 1, 'createBranch'],
];

for (const [label, className, occurrence, action] of submitInputs) {
  test(`${label}：选词回车不提交，输入结束后的独立回车才提交`, () => {
    const f = fixture();
    const handler = inputHandler(f, className, occurrence);
    const target = {};
    f.inputProps.onCompositionStart({ currentTarget: target });
    const composing = keyboard(target);
    handler(composing);
    assert.deepEqual(f.actions, []);
    assert.equal(composing.prevented, false, '不能阻止输入法确认候选');
    assert.equal(composing.stopped, false);

    f.inputProps.onCompositionEnd({ currentTarget: target });
    // 部分环境先结束 composition，再派发仍属于输入法的 229 确认键。
    const confirmation = keyboard(target, 'Enter', { isComposing: false, keyCode: 229 });
    handler(confirmation);
    assert.deepEqual(f.actions, []);
    assert.equal(confirmation.prevented, false);

    const submit = keyboard(target);
    handler(submit);
    assert.deepEqual(f.actions.map(x => x.name), [action]);
    assert.equal(submit.prevented, true);
  });

  test(`${label}：识别原生与 React 合成事件的输入法标记`, () => {
    const f = fixture();
    const handler = inputHandler(f, className, occurrence);
    for (const fields of [{ isComposing: true }, { nativeEvent: { isComposing: true } },
      { keyCode: 229 }, { nativeEvent: { keyCode: 229, isComposing: false } }]) {
      const event = keyboard({}, 'Enter', fields);
      handler(event);
      assert.deepEqual(f.actions, []);
      assert.equal(event.prevented, false);
      assert.equal(event.stopped, false);
    }
  });
}

test('Git 图中的分支输入：选词回车不被阻止，正常回车仍不创建分支', () => {
  const f = fixture();
  const handler = inputHandler(f, 'hud-branch-add-input');
  const target = {};
  f.inputProps.onCompositionStart({ currentTarget: target });
  const composition = keyboard(target);
  handler(composition);
  assert.equal(composition.prevented, false);
  f.inputProps.onCompositionEnd({ currentTarget: target });
  const normal = keyboard(target);
  handler(normal);
  assert.equal(normal.prevented, true);
  assert.deepEqual(f.actions, [], '该入口继续只由确认按钮创建分支');
});

test('所有键盘回调：输入法选词/取消不触发 HUD 操作；普通 Escape 保留原行为', () => {
  const matches = [...source.matchAll(/(?:onKeyDown:|const onKey(?:Down)? =)\s*\(event\) =>/g)];
  assert.ok(matches.length >= 13, '覆盖输入框、菜单捕获监听器和弹窗');
  for (const match of matches) {
    const f = fixture();
    const handler = f.callback(match.index);
    const body = callbackAt(match.index);
    const target = {};
    for (const key of ['Enter', 'Escape', 'ContextMenu', 'F10']) {
      const composing = keyboard(target, key, { nativeEvent: { isComposing: true }, shiftKey: true });
      handler(composing);
      assert.deepEqual(f.actions, [], body);
      assert.equal(composing.prevented, false, body);
      assert.equal(composing.stopped, false, body);
    }
    f.inputProps.onCompositionStart({ currentTarget: target });
    handler(keyboard(target, 'Escape'));
    assert.deepEqual(f.actions, [], '捕获阶段和冒泡阶段都要识别输入控件的 composition 状态');
    f.inputProps.onCompositionEnd({ currentTarget: target });
    handler(keyboard(target, 'Escape'));
    if (body.includes('"Escape"')) assert.equal(f.actions.length, 1, body);
    else assert.equal(f.actions.length, 0, body);
  }
});

test('composition 状态按控件隔离，失焦后可正常回车提交', () => {
  const f = fixture();
  const handler = inputHandler(f, 'hud-todo-input');
  const target = {}, other = {};
  f.inputProps.onCompositionStart({ currentTarget: target });
  handler(keyboard(other));
  assert.equal(f.actions.length, 1, '其他输入框不能被正在选词的控件锁住');
  handler(keyboard(target));
  assert.equal(f.actions.length, 1);
  f.inputProps.onBlur({ currentTarget: target });
  handler(keyboard(target));
  assert.equal(f.actions.length, 2, '失焦未派发 compositionend 也不残留锁定');
});

test('所有可编辑文本控件接入 composition 生命周期，包含便笺与提交信息', () => {
  const controls = [...source.matchAll(/react\.createElement\("(?:input|textarea)", \{/g)];
  const textControls = controls.map(match => {
    const start = source.indexOf('{', match.index);
    let depth = 0;
    for (let end = start; end < source.length; end++) {
      if (source[end] === '{') depth++;
      else if (source[end] === '}' && --depth === 0) return source.slice(start, end + 1);
    }
    throw new Error('Unclosed input props');
  }).filter(props => !props.includes('type: "checkbox"'));
  assert.equal(textControls.length, 7);
  for (const props of textControls) assert.ok(props.includes('...IME_INPUT_PROPS'), props);
});
