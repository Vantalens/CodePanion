const path = require('node:path');
const { test, expect } = require('@playwright/test');

const screenshotsDir = path.resolve(__dirname, '../../../output/playwright');
const viewports = [
  { width: 1200, height: 800 },
  { width: 900, height: 800 },
  { width: 390, height: 844 },
];

for (const viewport of viewports) {
  test(`workbench has no horizontal overflow at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('http://127.0.0.1:3000', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(screenshotsDir, `gui-${viewport.width}.png`),
      fullPage: true,
    });

    const result = await page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      return {
        pageOverflow: Math.max(doc.scrollWidth, body.scrollWidth) > window.innerWidth + 1,
        viewport: window.innerWidth,
        docScrollWidth: doc.scrollWidth,
        bodyScrollWidth: body.scrollWidth,
      };
    });

    expect(result).toEqual({
      pageOverflow: false,
      viewport: viewport.width,
      docScrollWidth: viewport.width,
      bodyScrollWidth: viewport.width,
    });
  });
}
