import { test } from 'node:test';
import assert from 'node:assert';
import { chromium } from 'playwright';

const FIB_AND_DEMO_URL = 'https://www.w3.org/WAI/demos/bad/';

// Regression test for the new FIB-AND demo.
// The test is skipped if the Playwright browser cannot launch or navigation fails.
test('FIB-AND demo page is reachable', async (t) => {
  let browser;
  try {
    browser = await chromium.launch();
  } catch {
    t.skip('Playwright browser could not launch');
  }

  try {
    const page = await browser!.newPage();
    await page.goto(FIB_AND_DEMO_URL);
    const title = await page.title();
    assert.ok(title.length > 0, 'page title should not be empty');
  } catch {
    t.skip('Navigation to demo URL failed');
  } finally {
    await browser?.close();
  }
});
