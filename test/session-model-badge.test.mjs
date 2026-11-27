// dsh-awesome-hud — v0.21.2：会话模块把「模型名 + 思考等级」合并成一个着色标签。
//  1) 关闭思考（Off）或模型没有思考档位 → 只显示模型名，灰色；
//  2) 未存等级 → 「模型名：Default」，蓝色；
//  3) 最低启用档 → 灰；最高档 → 紫；其余 → 蓝；
//  4) 档位顺序以 provider 声明的 `model.reasoning.efforts` 为准（DeepSeek 为 Off / Low / High / Max）。
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { extractFunction } from "./helpers/client-harness.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = await readFile(join(root, "lib/client.js"), "utf8");

const MODEL = "deepseek-v4.1-flash";

/** DeepSeek 适配器实际声明的档位顺序（含 Off），以及它的默认档位。 */
const DEEPSEEK_GROUPS = [{
  id: "deepseek",
  name: "DeepSeek",
  models: [{
    id: MODEL,
    name: "DeepSeek V4.1 Flash",
    reasoning: {
      efforts: [
        { id: "off", name: "Off" },
        { id: "low", name: "Low" },
        { id: "high", name: "High" },
        { id: "max", name: "Max" },
      ],
      defaultEffort: "high",
    },
  }],
}];

/** 只有 Off 一档（连接配置 thinking:"disabled"）与完全没有思考能力的模型。 */
const OFF_ONLY_GROUPS = [{ id: "deepseek", name: "DeepSeek", models: [{ id: "off-only", name: "Off Only", reasoning: { efforts: [{ id: "off", name: "Off" }], defaultEffort: "off" } }] }];
const PLAIN_GROUPS = [{ id: "plain", name: "Plain", models: [{ id: "plain-model", name: "Plain Model" }] }];

/** 在沙箱里加载 resolveModelBadge，注入与中英词典一致的分隔符 / Default 文案。 */
function loadBadge() {
  const context = vm.createContext({});
  vm.runInContext(extractFunction("resolveModelBadge"), context);
  return (selection, groups) => JSON.parse(JSON.stringify(context.resolveModelBadge(selection, groups, translate)));
}

/** 与中英词典一致的文案桩：中文用全角冒号、Default 固定英文。 */
const translate = (key) => ({ sessionEffortSeparator: "：", sessionEffortDefault: "Default" }[key] ?? key);

const badge = loadBadge();
const select = (reasoningEffort) => ({ provider: "deepseek", model: MODEL, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) });

test("无会话或选择为空时不渲染标签", () => {
  assert.equal(badge(null, DEEPSEEK_GROUPS), null);
  assert.equal(badge(undefined, DEEPSEEK_GROUPS), null);
});

test("最高档为紫色档位，最低启用档为灰色，中间档为蓝色", () => {
  assert.deepEqual(badge(select("max"), DEEPSEEK_GROUPS), { text: `${MODEL}：Max`, level: "high" });
  assert.deepEqual(badge(select("low"), DEEPSEEK_GROUPS), { text: `${MODEL}：Low`, level: "low" });
  // High 既不是最低也不是最高 → 蓝色档（mid）。
  assert.deepEqual(badge(select("high"), DEEPSEEK_GROUPS), { text: `${MODEL}：High`, level: "mid" });
});

test("关闭思考只显示模型名，并按关闭态着色", () => {
  assert.deepEqual(badge(select("off"), DEEPSEEK_GROUPS), { text: MODEL, level: "off" });
  // 只有 Off 一档：视为关闭思考。
  assert.deepEqual(badge({ provider: "deepseek", model: "off-only", reasoningEffort: "off" }, OFF_ONLY_GROUPS), { text: "off-only", level: "off" });
  assert.deepEqual(badge({ provider: "deepseek", model: "off-only" }, OFF_ONLY_GROUPS), { text: "off-only", level: "off" });
});

test("未存等级显示 Default，按默认档着色", () => {
  assert.deepEqual(badge(select(""), DEEPSEEK_GROUPS), { text: `${MODEL}：Default`, level: "default" });
  assert.deepEqual(badge({ provider: "deepseek", model: MODEL }, DEEPSEEK_GROUPS), { text: `${MODEL}：Default`, level: "default" });
});

test("模型没有思考元数据时只显示模型名", () => {
  assert.deepEqual(badge({ provider: "plain", model: "plain-model" }, PLAIN_GROUPS), { text: "plain-model", level: "off" });
});

test("存了目录里已不存在的档位时保留原始 id，按普通档着色", () => {
  assert.deepEqual(badge(select("ultra"), DEEPSEEK_GROUPS), { text: `${MODEL}：ultra`, level: "mid" });
});

test("Off 的别名（none / disabled）同样视为关闭思考", () => {
  const groups = [{ id: "x", name: "X", models: [{ id: "m", name: "M", reasoning: { efforts: [{ id: "none", name: "None" }, { id: "low", name: "Low" }] } }] }];
  assert.deepEqual(badge({ provider: "x", model: "m", reasoningEffort: "none" }, groups), { text: "m", level: "off" });
  assert.deepEqual(badge({ provider: "x", model: "m", reasoningEffort: "low" }, groups), { text: "m：Low", level: "low" });
});

test("样式：三档配色与单行省略都在样式表里", () => {
  // 灰档（off / low）沿用基础胶囊；中档与默认档为蓝色；高档为紫色（复用既有 lane 紫）。
  assert.match(source, /\.hud-model-chip\{border-radius:999px;padding:2px 10px;font-size:11px;line-height:18px;background:color-mix\(in srgb,var\(--dsw-alias-label-primary\) 8%,transparent\);color:var\(--dsw-alias-label-primary\);border:0;flex:none;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\}/);
  assert.match(source, /\.hud-model-chip\[data-level=default\],\.hud-model-chip\[data-level=mid\]\{color:var\(--dsw-alias-state-business-primary\);background:color-mix\(in srgb,var\(--dsw-alias-state-business-primary\) 14%,transparent\)\}/);
  assert.match(source, /\.hud-model-chip\[data-level=high\]\{color:var\(--hud-lane-5\);background:color-mix\(in srgb,var\(--hud-lane-5\) 14%,transparent\)\}/);
});

test("渲染接线：只渲染一个合并标签，旧的等级胶囊与函数已移除", () => {
  // v0.21.9：容器条件改为「模型标签或 Agent Team 标签任一存在」。
  assert.match(source, /props\.modelBadge === null && props\.agentTeamEnabled !== true \? null : react\.createElement\("div", \{ className: "hud-model-chips" \},/);
  assert.match(source, /"data-level": props\.modelBadge\.level,/);
  assert.match(source, /modelBadge: resolveModelBadge\(selection, modelSnapshot\.groups \?\? \[\], t\),/);
  assert.doesNotMatch(source, /effortLabel/);
  assert.doesNotMatch(source, /function resolveEffortLabel/);
});

test("文案：分隔符与 Default 在中英词典里成对存在", async () => {
  const { hudClient } = await import("./helpers/client-harness.mjs");
  const { zh, en } = hudClient().dictionaries[0];
  assert.equal(zh.sessionEffortSeparator, "：");
  assert.equal(en.sessionEffortSeparator, ": ");
  // 需求指定中英都显示英文 Default。
  assert.equal(zh.sessionEffortDefault, "Default");
  assert.equal(en.sessionEffortDefault, "Default");
});

test("用真实中英词典拼出的文案与设计一致", async () => {
  const { hudClient } = await import("./helpers/client-harness.mjs");
  const { zh, en } = hudClient().dictionaries[0];
  const context = vm.createContext({});
  vm.runInContext(extractFunction("resolveModelBadge"), context);
  const withZh = context.resolveModelBadge({ provider: "deepseek", model: MODEL, reasoningEffort: "max" }, DEEPSEEK_GROUPS, (key) => zh[key] ?? key);
  assert.equal(withZh.text, `${MODEL}：Max`, "中文档位用全角冒号");
  const defaultZh = context.resolveModelBadge({ provider: "deepseek", model: MODEL }, DEEPSEEK_GROUPS, (key) => zh[key] ?? key);
  assert.equal(defaultZh.text, `${MODEL}：Default`);
  const withEn = context.resolveModelBadge({ provider: "deepseek", model: MODEL, reasoningEffort: "max" }, DEEPSEEK_GROUPS, (key) => en[key] ?? key);
  assert.equal(withEn.text, `${MODEL}: Max`, "英文档位用半角冒号加空格");
  const offZh = context.resolveModelBadge({ provider: "deepseek", model: MODEL, reasoningEffort: "off" }, DEEPSEEK_GROUPS, (key) => zh[key] ?? key);
  assert.equal(offZh.text, MODEL, "关闭思考不拼档位");
});
