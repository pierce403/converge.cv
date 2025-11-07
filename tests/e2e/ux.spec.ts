import { test, expect } from '@playwright/test';

test('layout has stable bottom with no gap and only main scrolls', async ({ page }) => {
  await page.goto('/');

  // Create a new identity via onboarding (click Get Started or similar primary CTA)
  const start = page.getByRole('button', { name: /get started|generate|create/i });
  if (await start.isVisible()) {
    await start.click();
  }

  // Wait for chats view (presence of New Chat / New Group buttons)
  await expect(page.getByRole('link', { name: /new chat/i })).toBeVisible({ timeout: 20000 });

  // Open first conversation row if exists
  const firstRow = page.locator('main').locator('a[href^="/chat/"]').first();
  if (await firstRow.count()) {
    await firstRow.click();
  }

  // Ensure #root height ~= viewport height (no extra gap at bottom)
  const rootBox = await page.locator('#root').boundingBox();
  const viewport = page.viewportSize();
  expect(rootBox).not.toBeNull();
  if (rootBox && viewport) {
    const diff = Math.abs(rootBox.height - viewport.height);
    expect(diff).toBeLessThan(8); // within a few pixels tolerance
  }

  // Bottom nav is within viewport
  const navBox = await page.locator('nav').boundingBox();
  if (navBox && viewport) {
    expect(navBox.y + navBox.height).toBeLessThanOrEqual(viewport.height + 1);
  }

  // Body does not scroll; main scrolls
  const bodyOverflow = await page.evaluate(() => getComputedStyle(document.body).overflow);
  expect(bodyOverflow).toMatch(/hidden|clip/);
  const mainOverflowY = await page.evaluate(() => {
    const m = document.querySelector('main');
    return m ? getComputedStyle(m).overflowY : '';
  });
  expect(mainOverflowY).toMatch(/auto|scroll/);
});

