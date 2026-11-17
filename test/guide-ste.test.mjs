// dsh-awesome-hud — v0.19.0：「使用说明」页文案按 ASD-STE100 重写后的回归。
//  1) 句子长度：v0.21.2 起每条都是一行「名称：说明」，统一按英文 ≤20 词、中文 ≤24 字
//     （中文口径：汉字按字计，连续的拉丁字母/数字词元按 1 计，例如「System prompt」记 2）
//  2) 禁用词：英文 should / may / might / could / would；中文「建议」
//  3) 标点：禁分号与括号；每条以句号收尾；每条最多 3 句
//  4) 中英字典 guide* 键集合一致，便笺关键键仍在
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { hudClient, extractConst } from "./helpers/client-harness.mjs";

const sections = vm.runInNewContext(`${extractConst("GUIDE_SECTIONS")}\nGUIDE_SECTIONS;`);
const { zh, en } = hudClient().dictionaries[0];

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const LATIN_TOKEN = /[A-Za-z0-9][A-Za-z0-9._%+/-]*/g;
const FORBIDDEN_EN = /\b(should|may|might|could|would)\b/i;
const FORBIDDEN_ZH = /建议/;
const FORBIDDEN_PUNCT = /[;；()（）]/;

/** 英文按句号/问号/感叹号断句（文案中不使用 e.g. / i.e. 这类缩写，避免误判）。 */
const enSentences = (text) => text.split(/(?<=[.!?])\s+/).filter(Boolean);
/** 中文按句号断句，保留句号便于统一处理。 */
const zhSentences = (text) => text.split("。").filter(Boolean).map((part) => `${part}。`);
const enWords = (sentence) => sentence.split(/\s+/).filter(Boolean).length;

function zhUnits(sentence) {
  const cjk = (sentence.match(CJK) ?? []).length;
  const latin = (sentence.replace(CJK, " ").match(LATIN_TOKEN) ?? []).length;
  return cjk + latin;
}

// v0.21.2：不再区分展示 / 功能 / 设置，所有条目统一按「一行说清」的最紧口径校验。
const LIMITS = { en: 20, zh: 24 };

test("说明页文案：句长、标点与禁用词符合 ASD-STE100", () => {
  const problems = [];
  for (const section of sections) {
    for (const group of section.groups) {
      // 小标题只是一个短词（不带句号），单独校验存在性与长度。
      for (const dict of [zh, en]) {
        if (typeof dict[group.title] !== "string" || dict[group.title].length === 0) problems.push(`${group.title}：缺少小标题文案`);
      }
      // 每条「名称：说明」走同一口径：英文 ≤20 词、中文 ≤24 字，单句最多 3 句。
      for (const key of group.items) {
        const zhText = zh[key];
        const enText = en[key];
        if (typeof zhText !== "string" || typeof enText !== "string") {
          problems.push(`${key}：缺少中英文案`);
          continue;
        }
        const cases = [
          ["zh", zhText, zhSentences, zhUnits, "。"],
          ["en", enText, enSentences, enWords, "."],
        ];
        for (const [lang, text, toSentences, toLength, period] of cases) {
          if (!text.endsWith(period)) problems.push(`${key}/${lang}：未以「${period}」结尾 → ${text}`);
          if (FORBIDDEN_PUNCT.test(text)) problems.push(`${key}/${lang}：含分号或括号 → ${text}`);
          if (lang === "en" && FORBIDDEN_EN.test(text)) problems.push(`${key}/${lang}：含 STE 禁用情态动词 → ${text}`);
          if (lang === "zh" && FORBIDDEN_ZH.test(text)) problems.push(`${key}/${lang}：含「建议」→ ${text}`);
          const sentences = toSentences(text);
          if (sentences.length > 3) problems.push(`${key}/${lang}：${sentences.length} 句，上限 3 句 → ${text}`);
          for (const sentence of sentences) {
            const size = toLength(sentence);
            if (size > LIMITS[lang]) problems.push(`${key}/${lang}：${size} > ${LIMITS[lang]} → ${sentence}`);
          }
        }
      }
    }
  }
  assert.deepEqual(problems, [], `共 ${problems.length} 处不符合 STE 口径`);
});

test("说明页文案：中英字典 guide 键成对，便笺关键键仍在", () => {
  const guideKeys = (dict) => Object.keys(dict).filter((key) => key.startsWith("guide")).sort();
  assert.deepEqual(guideKeys(zh), guideKeys(en), "中英字典的 guide 键必须一一对应");
  for (const key of ["guideNoteImages", "guideNoteImport", "guideNoteImportEnabled", "guideNoteSend", "guideNoteClear"]) {
    assert.equal(typeof zh[key], "string", `${key} 需要中文文案`);
    assert.equal(typeof en[key], "string", `${key} 需要英文文案`);
  }
  const note = sections.find((section) => section.key === "note");
  // 跨 realm：先转成本 realm 的普通数组再比较。
  assert.deepEqual([...note.groups].map((group) => String(group.key)), ["module", "edit"], "便笺分为模块说明与编辑视图两个小标题");
  const editItems = note.groups[1].items;
  for (const key of ["guideNoteImages", "guideNoteImport", "guideNoteSend", "guideNoteClear"]) {
    assert.ok(editItems.includes(key), `编辑视图小标题应保留 ${key}`);
  }
  const moduleItems = note.groups[0].items;
  assert.ok(moduleItems.includes("guideNoteImportEnabled"), "模块说明应包含导入前置条件一条");
  assert.ok(moduleItems.length <= 12, "模块说明条目仍不超过 12 条");
});

test("说明页文案：不再出现实现细节与旧写法", () => {
  const internals = ["profile", "热重载", "HMR", "IndexedDB", "localStorage"];
  for (const text of [zh, en]) {
    const guideText = Object.keys(text)
      .filter((key) => key.startsWith("guide"))
      .map((key) => text[key])
      .join("\n");
    for (const word of internals) {
      assert.equal(guideText.includes(word), false, `说明页不应再出现实现细节「${word}」`);
    }
  }
});
