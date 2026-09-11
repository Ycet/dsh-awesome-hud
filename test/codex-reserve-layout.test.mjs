import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

test("reserve icon, label and quota are sibling flex items like the standard quota rows", () => {
  const start = source.indexOf("codexReserve.map(");
  const end = source.indexOf("\n", source.indexOf("fmtCodexPercent(limit.remainingPercent)", start));
  // Strip only the enclosing Fragment call's final parenthesis.
  const expression = source.slice(start, end).trim().slice(0, -1);
  for (const name of [null, "Team reserve"]) {
    const rows = vm.runInNewContext(expression, {
      codexReserve: [{ id: "gpt-reserve", name, remainingPercent: 35 }],
      react: { createElement: (type, props, ...children) => ({ type, props, children }) },
      Icon: "Icon", t: key => key, interpolate: (text, { name }) => `${text}: ${name}`,
      fmtCodexPercent: value => `${value}%`, openSettingsAccount() {},
    });
    const row = rows[0];
    assert.equal(row.children.length, 3);
    assert.equal(row.children[0].type, "Icon");
    assert.equal(row.children[1].props.className, "hud-row-label");
    assert.equal(row.children[1].children.length, 1);
    assert.equal(row.children[2].props.className, "hud-balance-value hud-click");
    assert.equal(row.children[2].children[0], "35%");
  }
});
