import type { Page, ElementHandle } from 'playwright';

export const FOCUSABLE_SELECTOR = 'a[href], button, input, select, textarea, summary, iframe, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export async function screenshotProbe(page: Page, el: ElementHandle) {
  const box = await el.boundingBox();
  if (!box) return null;
  return await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
}
