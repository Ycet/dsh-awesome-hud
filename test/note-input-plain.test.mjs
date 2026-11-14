// dsh-awesome-hud — v0.19.0 便笺输入框只收纯文本与图片：
//  1) 源码里不再有 `/` `@` 补全的实现（触发解析 / 候选数据源 / 菜单组件 / 样式 / 文案）
//  2) 便笺 textarea 不再挂补全键盘与光标监听
//  3) 「使用说明」的便笺分节不再有 `/` `@` 要点，中英字典两侧一致
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { hudClient, clientSource as source, extractConst } from "./helpers/client-harness.mjs";

const FORBIDDEN = [
  "noteTriggerAt",
  "noteInsertToken",
  "noteMentionDirectory",
  "noteFilterCandidates",
  "NOTE_TRIGGER_DEBOUNCE_MS",
  "NOTE_TRIGGER_MAX_ITEMS",
  "NOTE_SKILL_CACHE_MS",
  "noteSkillCache",
  "loadNoteSkills",
  "loadNoteCommands",
  "loadNoteFiles",
  "NoteTriggerMenu",
  "guideNoteSlashAt",
  "noteMenuSkills",
  "noteMenuFiles",
  "noteMenuEmpty",
  "noteMenuLoading",
  "hud-note-menu",
];

test("便笺不再有 / 与 @ 补全：实现、样式与文案都不残留", () => {
  for (const marker of FORBIDDEN) {
    assert.equal(source.includes(marker), false, `${marker} 应从插件中移除`);
  }
  // 便笺不再查询 skill / 命令 / 目录：这三处数据源调用只属于旧补全
  assert.equal(/remote\?\.skills/.test(source), false, "不再读取 skill 列表");
  assert.equal(/remote\?\.commands/.test(source), false, "不再读取命令列表");
});

test("便笺 textarea 只处理输入与粘贴，不挂补全键盘/光标监听", () => {
  const noteStart = source.indexOf('className: "hud-note-area"');
  assert.ok(noteStart > 0, "应存在便笺 textarea");
  const noteBlock = source.slice(noteStart, noteStart + 700);
  // v0.20.0：编辑视图写入当前便笺（多便笺：updateNote(note.id, { text })）。
  assert.match(noteBlock, /onChange: \(event\) => updateNote\(note\.id, \{ text: event\.target\.value \}\)/);
  assert.match(noteBlock, /onPaste,/);
  assert.equal(noteBlock.includes("onKeyUp"), false, "不再用 onKeyUp 追踪补全 token");
  assert.equal(noteBlock.includes("onClick"), false, "不再用 onClick 追踪补全 token");
  assert.equal(noteBlock.includes("trackTrigger"), false);
});

test("说明页便笺分节：展示 / 功能 / 设置三组，且不含 / 与 @ 要点", () => {
  const sections = vm.runInNewContext(`${extractConst("GUIDE_SECTIONS")}\nGUIDE_SECTIONS;`);
  const note = sections.find((section) => section.key === "note");
  assert.ok(note !== undefined, "应有便笺分节");
  // v0.20.0：新增「设置」组（便笺条数上限）。
  assert.deepEqual(JSON.parse(JSON.stringify(note.groups.map((group) => group.kind))), ["show", "act", "set"]);
  const actItems = note.groups[1].items;
  assert.equal(actItems.includes("guideNoteSlashAt"), false);
  for (const key of ["guideNoteImages", "guideNoteImport", "guideNoteSend", "guideNoteClear"]) {
    assert.ok(actItems.includes(key), `功能分组应保留 ${key}`);
  }
  // 中英字典两侧仍成对（guide 键集合一致）
  const dicts = hudClient().dictionaries[0];
  const guideKeys = (dict) => Object.keys(dict).filter((key) => key.startsWith("guide")).sort();
  assert.deepEqual(guideKeys(dicts.zh), guideKeys(dicts.en));
  assert.equal(dicts.zh.guideNoteSlashAt, undefined);
  assert.equal(dicts.en.guideNoteSlashAt, undefined);
});
