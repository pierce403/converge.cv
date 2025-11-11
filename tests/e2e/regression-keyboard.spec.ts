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

  // Wait for and interact with the "Make it yours" personalization modal
  const modalHeading = page.getByRole('heading', { name: /make it yours/i });
  await expect(modalHeading).toBeVisible({ timeout: 60_000 });

  const displayName = createDisplayName();
  // The input has placeholder "Your name" and is within the modal dialog
  const nameInput = page.getByRole('dialog').getByPlaceholder('Your name');
  await expect(nameInput).toBeVisible({ timeout: 10_000 });
  await nameInput.fill(displayName);

  const saveButton = page.getByRole('button', { name: /^save$/i });
  await expect(saveButton).toBeVisible();
  await saveButton.click();

  // Wait for modal to close and app to be ready
  await expect(modalHeading).not.toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('link', { name: /new chat/i })).toBeVisible({ timeout: 60_000 });

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

  // Verify message appears in the conversation view
  await expect(page.getByText(MESSAGE_TEXT, { exact: true })).toBeVisible({ timeout: 30_000 });

  // Navigate back to chat list to verify conversation appears
  await page.goto('/');
  await expect(page.getByRole('link', { name: /new chat/i })).toBeVisible({ timeout: 30_000 });

  // Wait for the conversation to appear in the list
  // Try to find a link that contains the message text, or deanpierce, or any /chat/ link
  // First try message text (most reliable)
  let conversationLink = page.getByRole('link').filter({ hasText: MESSAGE_TEXT }).first();
  try {
    await expect(conversationLink).toBeVisible({ timeout: 5_000 });
  } catch {
    // Fallback: try finding by deanpierce
    conversationLink = page.getByRole('link').filter({ hasText: /deanpierce/i }).first();
    try {
      await expect(conversationLink).toBeVisible({ timeout: 5_000 });
    } catch {
      // Last resort: find any link that goes to /chat/ (excluding new-chat)
      conversationLink = page.locator('a[href^="/chat/"]').first();
      await expect(conversationLink).toBeVisible({ timeout: 20_000 });
    }
  }

  // Click on the conversation to open it
  await conversationLink.click();
  await expect(page).toHaveURL(/\/chat\//, { timeout: 10_000 });

  // Verify the message is visible in the conversation view
  await expect(page.getByText(MESSAGE_TEXT, { exact: true })).toBeVisible({ timeout: 30_000 });

  expect(pageErrors, `Unexpected page errors: ${pageErrors.map((err) => err.message).join('; ')}`).toEqual([]);
  expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join('; ')}`).toEqual([]);
});
