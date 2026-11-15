// dsh-awesome-hud — v0.20.1：「更新日志」页文案按 ASD-STE100 撰写的回归。
//  1) 每条要点一句话：英文 ≤20 词、中文 ≤24 字（汉字按字计，连续拉丁字母/数字词元按 1 计）
//  2) 分组标题为名词短语（不带句号）：英文 ≤8 词、中文 ≤16 字
//  3) 禁用词：英文 should / may / might / could / would；中文「建议」
//  4) 标点：正文禁分号与括号；每条要点以句号收尾
//  5) 不写实现细节（profile / HMR / IndexedDB / localStorage / 测试基线）
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { hudClient, extractConst } from "./helpers/client-harness.mjs";

const entries = vm.runInNewContext(`${extractConst("CHANGELOG_ENTRIES")}\nCHANGELOG_ENTRIES;`);
const { zh, en } = hudClient().dictionaries[0];

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const LATIN_TOKEN = /[A-Za-z0-9][A-Za-z0-9._%+/-]*/g;
const FORBIDDEN_EN = /\b(should|may|might|could|would)\b/i;
const FORBIDDEN_ZH = /建议/;
const FORBIDDEN_PUNCT = /[;；()（）]/;
const INTERNALS = ["profile", "热重载", "HMR", "IndexedDB", "localStorage", "测试基线", "test/"];

/** 英文按句号/问号/感叹号断句（文案里不使用 e.g. / i.e. 这类缩写，避免误判）。 */
const enSentences = (text) => text.split(/(?<=[.!?])\s+/).filter(Boolean);
/** 中文按句号断句，保留句号便于统一处理。 */
const zhSentences = (text) => text.split("。").filter(Boolean).map((part) => `${part}。`);
const enWords = (sentence) => sentence.split(/\s+/).filter(Boolean).length;

function zhUnits(sentence) {
  const cjk = (sentence.match(CJK) ?? []).length;
  const latin = (sentence.replace(CJK, " ").match(LATIN_TOKEN) ?? []).length;
  return cjk + latin;
}

const itemKeys = [];
for (const entry of entries) for (const group of entry.groups) itemKeys.push(...group.items);
const titleKeys = entries.flatMap((entry) => entry.groups.map((group) => group.title));

test("更新日志要点：一句话、句长、标点与禁用词符合 ASD-STE100", () => {
  const problems = [];
  for (const key of itemKeys) {
    const zhText = zh[key];
    const enText = en[key];
    if (typeof zhText !== "string" || typeof enText !== "string") {
      problems.push(`${key}：缺少中英文案`);
      continue;
    }
    const cases = [
      ["zh", zhText, zhSentences, zhUnits, "。", 24],
      ["en", enText, enSentences, enWords, ".", 20],
    ];
    for (const [lang, text, toSentences, toLength, period, limit] of cases) {
      if (!text.endsWith(period)) problems.push(`${key}/${lang}：未以「${period}」结尾 → ${text}`);
      if (FORBIDDEN_PUNCT.test(text)) problems.push(`${key}/${lang}：含分号或括号 → ${text}`);
      if (lang === "en" && FORBIDDEN_EN.test(text)) problems.push(`${key}/${lang}：含 STE 禁用情态动词 → ${text}`);
      if (lang === "zh" && FORBIDDEN_ZH.test(text)) problems.push(`${key}/${lang}：含「建议」→ ${text}`);
      const sentences = toSentences(text);
      if (sentences.length !== 1) problems.push(`${key}/${lang}：应为 1 句，实际 ${sentences.length} 句 → ${text}`);
      for (const sentence of sentences) {
        const size = toLength(sentence);
        if (size > limit) problems.push(`${key}/${lang}：${size} > ${limit} → ${sentence}`);
      }
    }
  }
  assert.deepEqual(problems, [], `共 ${problems.length} 处不符合 STE 口径`);
});

test("更新日志分组标题：名词短语、无句号、句长克制", () => {
  const problems = [];
  for (const key of titleKeys) {
    const cases = [
      ["zh", zh[key], zhUnits, 16],
      ["en", en[key], enWords, 8],
    ];
    for (const [lang, text, toLength, limit] of cases) {
      if (typeof text !== "string" || text === "") {
        problems.push(`${key}/${lang}：缺少文案`);
        continue;
      }
      // 标题是名词短语，不以句号收尾。
      if (/[.。]$/.test(text)) problems.push(`${key}/${lang}：标题不应带句号 → ${text}`);
      if (FORBIDDEN_PUNCT.test(text)) problems.push(`${key}/${lang}：含分号或括号 → ${text}`);
      const size = toLength(text);
      if (size > limit) problems.push(`${key}/${lang}：${size} > ${limit} → ${text}`);
    }
  }
  assert.deepEqual(problems, [], `共 ${problems.length} 处不符合标题口径`);
});

test("更新日志文案：不写实现细节，键集合中英一致", () => {
  const keysOf = (dict) => Object.keys(dict).filter((key) => key.startsWith("changelog") || key === "settingsChangelogTab").sort();
  assert.deepEqual(keysOf(zh), keysOf(en), "中英 changelog 键必须一一对应");
  for (const [lang, dict] of [["zh", zh], ["en", en]]) {
    const text = [...itemKeys, ...titleKeys, "settingsChangelogTab", "changelogLatest"].map((key) => dict[key] ?? "").join("\n");
    for (const word of INTERNALS) assert.equal(text.includes(word), false, `${lang} 文案不应出现实现细节「${word}」`);
  }
});
