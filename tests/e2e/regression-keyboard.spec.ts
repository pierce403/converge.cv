import { test, expect } from '@playwright/test';

const MESSAGE_TEXT = 'this is only a test';

function createDisplayName(): string {
  const randomSuffix = Math.floor(Math.random() * 10_000);
  return `potato test ${randomSuffix}`;
}

test('regression: rename identity and send DM to deanpierce.eth', async ({ page }) => {
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

  const createIdentityButton = page.getByRole('button', { name: /create new identity/i }).first();
  await expect(createIdentityButton).toBeVisible({ timeout: 60_000 });
  await createIdentityButton.click();

  await expect(page.getByRole('link', { name: /new chat/i })).toBeVisible({ timeout: 60_000 });

  const settingsButton = page.getByTitle('Settings');
  await expect(settingsButton).toBeVisible();
  await settingsButton.click();

  const editButton = page.getByRole('button', { name: /^edit$/i });
  await expect(editButton).toBeVisible({ timeout: 20_000 });
  await editButton.click();

  const displayName = createDisplayName();
  const nameInput = page.getByPlaceholder('Enter display name');
  await expect(nameInput).toBeVisible();
  await nameInput.fill(displayName);

  const saveButton = page.getByRole('button', { name: /^save$/i });
  await saveButton.click();
  await page.waitForTimeout(1000);

  await expect(page.getByText(displayName, { exact: true })).toBeVisible({ timeout: 20_000 });

  await page.goto('/');
  await expect(page.getByRole('link', { name: /new chat/i })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('link', { name: /new chat/i }).click();
  await expect(page).toHaveURL(/\/new-chat/);

  const addressInput = page.getByLabel('Ethereum Address or ENS Name');
  await expect(addressInput).toBeVisible();
  await addressInput.fill('deanpierce.eth');

  const startChatButton = page.getByRole('button', { name: /start chat/i });
  await expect(startChatButton).toBeEnabled();
  await Promise.all([
    page.waitForURL(/\/chat\//, { timeout: 60_000 }),
    startChatButton.click(),
  ]);

  const composer = page.getByPlaceholder('Type a message...');
  await expect(composer).toBeVisible({ timeout: 60_000 });
  await expect(composer).toBeEnabled();
  await composer.fill(MESSAGE_TEXT);
  await composer.press('Enter');

  await expect(page.getByText(MESSAGE_TEXT, { exact: true })).toBeVisible({ timeout: 30_000 });

  expect(pageErrors, `Unexpected page errors: ${pageErrors.map((err) => err.message).join('; ')}`).toEqual([]);
  expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join('; ')}`).toEqual([]);
});
