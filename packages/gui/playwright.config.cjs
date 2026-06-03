const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: /.*\.pw\.cjs/,
  outputDir: '../../output/playwright/test-results',
  reporter: 'line',
  use: {
    browserName: 'chromium',
  },
});
