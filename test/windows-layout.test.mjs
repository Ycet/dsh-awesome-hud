import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { hudClient } from './helpers/client-harness.mjs';

const runtime = process.env.HUD_TEST_PLAYWRIGHT_ROOT;

// 真实 CSS 布局和命中测试；原生标题栏控件用更高层的占位区域模拟。
// 浏览器依赖由验收环境提供，发布包不引入浏览器运行时依赖。
test('Windows / 全屏 / macOS / Web 的新会话 HUD 可见、可点击且不落入标题栏控件', {
  skip: !runtime, timeout: 30000,
}, async () => {
  const { chromium } = createRequire(import.meta.url)(runtime);
  const browser = await chromium.launch({ headless: true,
    ...(process.env.HUD_TEST_BROWSER_EXECUTABLE ? { executablePath: process.env.HUD_TEST_BROWSER_EXECUTABLE } : {}),
  });
  try {
    for (const [platform, fullscreen, top] of [['win32', false, 52], ['win32', true, 12], ['darwin', false, 12], ['web', false, 12]]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const windows = platform === 'win32';
      await page.setContent(`<html ${windows ? 'data-windows-titlebar' : ''} ${fullscreen ? 'data-fullscreen' : ''}
        style="--dsh-windows-titlebar-height:40px;--dsh-frame-chrome-top:${windows && !fullscreen ? 40 : 0}px">
        <head><style>#overlay>*{pointer-events:auto}</style></head><body><div id="overlay" style="z-index:20;position:absolute;inset:0;pointer-events:none"></div>
        ${windows && !fullscreen ? '<div id="caption" style="position:fixed;right:0;top:0;width:138px;height:40px;z-index:2147483000;background:#ccc">Caption controls</div>' : ''}</body></html>`);
      const client = hudClient({ windows, fullscreen });
      const { className, style } = client.button().props;
      await page.addStyleTag({ content: client.styles.join('\n') });
      await page.evaluate(({ className, style }) => {
        const button = document.createElement('button'); button.id = 'hud'; button.className = className;
        Object.assign(button.style, style); button.onclick = () => button.dataset.clicked = 'true';
        document.querySelector('#overlay').append(button);
      }, { className, style });
      const geometry = await page.locator('#hud').evaluate(button => {
        const rect = button.getBoundingClientRect();
        return { top: rect.top, hit: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.id,
          appRegion: getComputedStyle(button).webkitAppRegion };
      });
      assert.equal(geometry.top, top, `${platform} fullscreen=${fullscreen}`);
      assert.equal(geometry.hit, 'hud');
      assert.equal(geometry.appRegion, 'no-drag');
      await page.locator('#hud').click();
      assert.equal(await page.locator('#hud').getAttribute('data-clicked'), 'true');
      await page.close();
    }
  } finally { await browser.close(); }
});
