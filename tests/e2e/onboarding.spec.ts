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

    const createInbox = page.getByRole('button').filter({
      has: page.getByText('Create new Converge inbox', { exact: true }),
    });
    await expect(createInbox).toBeVisible({ timeout: 30_000 });
    await createInbox.click();

    const profileDialog = page.getByRole('dialog', { name: /choose your inbox profile/i });
    await expect(profileDialog).toBeVisible({ timeout: 60_000 });
    await profileDialog.getByRole('button', { name: /^continue$/i }).click();
    await expect(profileDialog).toBeHidden();

    await expect(page.getByRole('link', { name: /new chat/i })).toBeVisible({ timeout: 60_000 });

    expect(pageErrors, `Unexpected page errors: ${pageErrors.map((err) => err.message).join('; ')}`).toEqual([]);
    expect(
      consoleErrors,
      `Unexpected console errors: ${consoleErrors.join('; ')}`
    ).toEqual([]);
});
