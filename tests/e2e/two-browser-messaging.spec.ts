import { test, expect, type BrowserContext, type Page } from '@playwright/test';

async function dismissPersonalizationReminder(page: Page) {
  try {
    const modalHeader = page.getByText(/make it yours/i);
    await modalHeader.waitFor({ state: 'visible', timeout: 5000 });
    await page.getByText("Don't remind me again").click();
    await page.locator('.fixed.inset-0').filter({ hasText: /make it yours/i }).waitFor({ state: 'detached', timeout: 10000 });
  } catch (error) {
    // Modal did not appear; nothing to dismiss.
  }
}

async function completeOnboarding(page: Page) {
  await page.goto('/');

  try {
    await expect(page.getByText('Loading...')).not.toBeVisible({ timeout: 15000 });
  } catch (error) {
    // Loading indicator not present; continue.
  }

  const startButtons = page.getByRole('button', { name: /get started|create new identity|generate|create/i });
  if (await startButtons.isVisible()) {
    await startButtons.click();
  }

  await expect(page.getByRole('link', { name: /new chat/i })).toBeVisible({ timeout: 60_000 });
  await dismissPersonalizationReminder(page);
}

async function waitForInboxId(page: Page) {
  await page.waitForFunction(() => {
    // @ts-expect-error accessing injected store
    return window.useAuthStore?.getState?.()?.identity?.inboxId;
  }, { timeout: 20_000 });

  const inboxId = await page.evaluate(() => {
    // @ts-expect-error accessing injected store
    return window.useAuthStore?.getState?.()?.identity?.inboxId || null;
  });

  expect(inboxId).toBeTruthy();
  return inboxId as string;
}

async function setDisplayName(page: Page, displayName: string) {
  const switcherButton = page.getByRole('button', { name: /current inbox/i });
  await expect(switcherButton).toBeVisible();
  await switcherButton.click();

  const nameInput = page.getByLabel('Display name');
  await expect(nameInput).toBeVisible();
  await nameInput.fill(displayName);

  const saveButton = page.getByRole('button', { name: /save display name/i });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  // Wait for the button text to return to idle state, then close the menu.
  await expect(saveButton).toHaveText(/save display name/i, { timeout: 15_000 });
  await page.keyboard.press('Escape');

  // Verify the switcher button shows the updated label.
  await expect(switcherButton).toContainText(displayName);
}

async function onboardWithName(page: Page, displayName: string) {
  await completeOnboarding(page);
  const inboxId = await waitForInboxId(page);
  await setDisplayName(page, displayName);
  return inboxId;
}

async function startConversation(page: Page, peerInboxId: string) {
  await page.getByRole('link', { name: /new chat/i }).click();
  await expect(page).toHaveURL(/\/new-chat/);

  const input = page.getByLabel('Ethereum Address or ENS Name');
  await input.fill(peerInboxId);
  await page.getByRole('button', { name: /start chat/i }).click();

  await expect(page).toHaveURL(/\/chat\//, { timeout: 30_000 });
}

async function sendMessage(page: Page, message: string) {
  const composer = page.getByPlaceholder('Type a message...');
  await expect(composer).toBeVisible({ timeout: 20_000 });
  await composer.fill(message);
  await composer.press('Enter');
  await expect(page.getByText(message)).toBeVisible({ timeout: 30_000 });
}

async function openConversation(page: Page, identifier: string) {
  const conversation = page.getByRole('link').filter({ hasText: identifier }).first();
  await expect(conversation).toBeVisible({ timeout: 60_000 });
  await conversation.click();
  await expect(page).toHaveURL(/\/chat\//, { timeout: 30_000 });
}

async function expectHeaderToShowName(page: Page, displayName: string) {
  const headerName = page.locator('header').getByText(displayName, { exact: false });
  await expect(headerName).toBeVisible({ timeout: 20_000 });
}

test('two browsers exchange messages and show display names', async ({ browser, baseURL }) => {
  const contextOptions = baseURL ? { baseURL } : undefined;
  const contextA: BrowserContext = await browser.newContext(contextOptions);
  const contextB: BrowserContext = await browser.newContext(contextOptions);

  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const displayNameA = `Tester A ${Date.now()}`;
  const displayNameB = `Tester B ${Date.now()}`;

  const inboxA = await onboardWithName(pageA, displayNameA);
  const inboxB = await onboardWithName(pageB, displayNameB);

  // A starts the conversation with B and sends the first message.
  await startConversation(pageA, inboxB);
  const messageFromA = `A -> B ${Date.now()}`;
  await sendMessage(pageA, messageFromA);
  await expectHeaderToShowName(pageA, displayNameB);

  // B opens the new conversation, sees A's display name, and replies.
  await openConversation(pageB, displayNameA);
  await expect(pageB.getByText(messageFromA)).toBeVisible({ timeout: 60_000 });
  await expectHeaderToShowName(pageB, displayNameA);

  const replyFromB = `B -> A ${Date.now()}`;
  await sendMessage(pageB, replyFromB);

  // A sees B's reply and sends a follow-up.
  await expect(pageA.getByText(replyFromB)).toBeVisible({ timeout: 60_000 });
  const followUpFromA = `A follow-up ${Date.now()}`;
  await sendMessage(pageA, followUpFromA);

  // B receives the follow-up and both participants retain display names.
  await expect(pageB.getByText(followUpFromA)).toBeVisible({ timeout: 60_000 });
  await expectHeaderToShowName(pageA, displayNameB);
  await expectHeaderToShowName(pageB, displayNameA);

  await contextA.close();
  await contextB.close();
});
