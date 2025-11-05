import { test, expect } from '@playwright/test';

test.describe('Converge onboarding and navigation', () => {
  test('creates identity, navigates app, and sends a message', async ({ page }) => {
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

    await expect(page.getByRole('heading', { name: 'Welcome to Converge' })).toBeVisible();

    await page.getByRole('button', { name: 'Create new identity' }).click();

    await expect(page.getByText('Setting things up…')).toBeVisible();

    await expect(page.getByRole('link', { name: 'Chats' })).toBeVisible({ timeout: 60_000 });

    await page.getByRole('link', { name: 'Contacts' }).click();
    await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();

    await page.getByRole('link', { name: 'Chats' }).click();
    await expect(page.getByText('Start a new chat to begin messaging')).toBeVisible();

    await page.getByTitle('Search').click();
    await expect(page.getByPlaceholder('Search messages...')).toBeVisible();
    await page.goBack();

    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    await page.getByRole('link', { name: 'Chats' }).click();

    await page.getByRole('link', { name: 'New Chat' }).click();
    await expect(page.getByRole('heading', { name: 'New Chat' })).toBeVisible();

    await page.getByLabel('Ethereum Address or ENS Name').fill('deanpierce.eth');
    await page.getByRole('button', { name: 'Start Chat' }).click();

    await expect(page.getByPlaceholder('Type a message...')).toBeVisible({ timeout: 30_000 });

    const messageText = `Automated hello ${Date.now()}`;
    const input = page.getByPlaceholder('Type a message...');
    await input.fill(messageText);
    await input.press('Enter');

    await expect(page.getByText(messageText)).toBeVisible();

    expect(pageErrors, `Unexpected page errors: ${pageErrors.map((err) => err.message).join('; ')}`).toEqual([]);
    expect(
      consoleErrors,
      `Unexpected console errors: ${consoleErrors.join('; ')}`
    ).toEqual([]);
  });
});
