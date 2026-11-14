// dsh-awesome-hud — v0.19.0：「使用说明」页文案按 ASD-STE100 重写后的回归。
//  1) 句子长度：英文功能组 ≤20 词、展示/设置组 ≤25 词；中文功能组 ≤24 字、其余 ≤28 字
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

const limitsFor = (kind) => (kind === "act" ? { en: 20, zh: 24 } : { en: 25, zh: 28 });

test("说明页文案：句长、标点与禁用词符合 ASD-STE100", () => {
  const problems = [];
  for (const section of sections) {
    for (const group of section.groups) {
      const limit = limitsFor(group.kind);
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
            if (size > limit[lang]) problems.push(`${key}/${lang}：${size} > ${limit[lang]} → ${sentence}`);
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
  assert.ok(note.groups[1].items.includes("guideNoteImportEnabled"), "便笺功能组应包含导入前置条件一条");
  // v0.20.0：多便笺新增列表/编辑/拖动/上限等条目，功能组上限放宽到 12 条。
  assert.ok(note.groups[1].items.length <= 12, "便笺功能组仍不超过 12 条");
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
