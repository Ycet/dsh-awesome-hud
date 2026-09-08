import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("HUD client reads rc.1 pending interactions through the standard root hook", async () => {
  const [source, packageText] = await Promise.all([
    readFile(join(root, "lib/client.js"), "utf8"),
    readFile(join(root, "package.json"), "utf8")
  ]);
  const pkg = JSON.parse(packageText);

  assert.equal(pkg.version, "0.11.0");
  assert.ok(pkg.dsh.client.inject.includes("@deepseek-ai/dsh-client-ui-session"));
  assert.match(source, /function HudPanel\(\{ useSessionPendingInteraction = useNoPendingInteraction \}\)/);
  assert.match(source, /const pending = useSessionPendingInteraction\(\(snapshot\) =>/);
  assert.match(source, /current === undefined \? undefined : snapshot\?\.get\?\.\(current\)/);
  assert.match(source, /pendingInteraction: pending\?\.kind/);
  assert.doesNotMatch(source, /pendingInteraction: summary\?\.pendingInteraction/);
  assert.match(source, /function HudPanelRoot\(\{ useSessionPendingInteraction \}\)/);
  assert.match(source, /react\.createElement\(HudPanel, \{ useSessionPendingInteraction \}\)/);
});

test("HUD-03 reserves only the conversation body so rc.1 width handles and turn navigation remain usable", async () => {
  const [source, packageText] = await Promise.all([
    readFile(join(root, "lib/client.js"), "utf8"),
    readFile(join(root, "package.json"), "utf8")
  ]);
  const pkg = JSON.parse(packageText);

  assert.equal(pkg.version, "0.11.0");
  assert.match(source, /const TURN_NAVIGATION_RIGHT_GAP = 12;/);
  assert.match(source, /const TURN_NAVIGATION_MIN_COLUMN_WIDTH = 720;/);
  assert.match(source, /const conversationRoot = sessionHost\?\.closest\("\[data-phase\]"\) \?\? null;/);
  assert.match(source, /const conversationBody = conversationRoot\?\.querySelector\("\[data-conversation-scroll\]"\)\?\.parentElement \?\? null;/);
  assert.match(source, /conversationBody\.style\.setProperty\("margin-right", `\$\{PANEL_WIDTH\}px`\);/);
  assert.match(source, /conversationBody\.style\.setProperty\("--dsh-awesome-hud-column-width", `\$\{Math\.round\(columnWidth\)\}px`\);/);
  assert.match(source, /conversationBody\.style\.setProperty\("--dsh-chat-content-width", HUD_CONTENT_WIDTH\);/);
  assert.match(source, /conversationBody\.style\.setProperty\("--dsh-composer-card-max-width", "calc\(var\(--dsh-chat-content-width\) \+ 32px\)"\);/);
  assert.match(source, /nav\[aria-label="轮次导航"\], nav\[aria-label="Turn navigation"\]/);
  assert.match(source, /slot\.style\.setProperty\("display", "block"\);/);
  assert.match(source, /nav\.style\.setProperty\("right", `\$\{TURN_NAVIGATION_RIGHT_GAP\}px`\);/);
  assert.doesNotMatch(source, /conversationRoot\.style\.setProperty\("margin-right"/);
  assert.doesNotMatch(source, /pushBody\.style\.marginRight/);
  assert.doesNotMatch(source, /sessionHost\?\.parentElement/);
});
