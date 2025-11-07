import { test, expect } from '@playwright/test';

test('onboarding smoke (simplified)', async ({ page }) => {
    const pageErrors: Error[] = [];
    const consoleErrors: string[] = [];

    page.on('pageerror', (error) => {
      pageErrors.push(error);
    });

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    await page.goto('/');

    // Try to find a primary CTA and proceed to app shell
    const start = page.getByRole('button', { name: /get started|create|generate/i });
    if (await start.isVisible()) {
      await start.click();
    }
    await expect(page.getByRole('link', { name: /new chat/i })).toBeVisible({ timeout: 60_000 });

    expect(pageErrors, `Unexpected page errors: ${pageErrors.map((err) => err.message).join('; ')}`).toEqual([]);
    expect(
      consoleErrors,
      `Unexpected console errors: ${consoleErrors.join('; ')}`
    ).toEqual([]);
});
