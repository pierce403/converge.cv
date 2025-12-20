import { test, expect, type BrowserContext, type Page } from '@playwright/test';

async function setDisplayNameInModal(page: Page, displayName: string) {
  try {
    const modalHeader = page.getByText(/make it yours/i);
    await modalHeader.waitFor({ state: 'visible', timeout: 30000 });

    const modal = page.locator('.fixed.inset-0').filter({ hasText: /make it yours/i });
    const input = modal.locator('input[type="text"]');
    await input.fill(displayName);

    await modal.getByRole('button', { name: /^save$/i }).click();
    await modal.waitFor({ state: 'detached', timeout: 10000 });
    console.log(`[Test] Set display name to: ${displayName}`);
  } catch (error) {
    console.log('[Test] Personalization modal did not appear or failed:', error);
  }
}

async function onboardWithName(page: Page, displayName: string) {
  console.log(`[Test] onboardWithName: Starting for ${displayName}`);

  await page.goto('/');
  console.log(`[Test] onboardWithName: Navigated to / for ${displayName}`);

  try {
    await expect(page.getByText('Loading...')).not.toBeVisible({ timeout: 15000 });
  } catch {
    // ignore loading screen
  }

  const createButton = page.getByRole('button', { name: /create new identity/i });
  await createButton.waitFor({ state: 'visible', timeout: 30000 });
  await createButton.click();

  await expect(page.getByRole('link', { name: /new chat/i })).toBeVisible({ timeout: 60_000 });

  await page.waitForFunction(
    () => {
      // @ts-expect-error accessing injected store
      const identity = window.useAuthStore?.getState?.()?.identity;
      return identity?.inboxId && !identity.inboxId.startsWith('local-');
    },
    { timeout: 120000 }
  );

  await setDisplayNameInModal(page, displayName);

  const identifier = await getIdentifier(page);
  console.log(`[Test] onboardWithName: Got identifier for ${displayName}: ${identifier}`);
  return identifier;
}

async function getIdentifier(page: Page): Promise<string> {
  const identifier = await page.evaluate(async () => {
    for (let i = 0; i < 20; i++) {
      // @ts-expect-error accessing injected store
      const identity = window.useAuthStore?.getState?.()?.identity;
      if (identity?.address) {
        return identity.address;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  });

  if (identifier) {
    return identifier;
  }

  throw new Error('Could not find identifier from store');
}

async function startConversation(page: Page, peer: string) {
  await page.getByRole('link', { name: /new chat/i }).click();
  await expect(page).toHaveURL(/\/new-chat/);

  const input = page.getByLabel('Ethereum Address or ENS Name');
  await input.fill(peer);
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
  let conversation = page.getByRole('link').filter({ hasText: identifier.slice(0, 10) }).first();

  try {
    await conversation.waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    conversation = page.locator('a[href^="/chat/"]').first();
  }

  await expect(conversation).toBeVisible({ timeout: 60_000 });
  await conversation.click();
  await expect(page).toHaveURL(/\/chat\//, { timeout: 30_000 });
}

async function syncInbox(page: Page) {
  await page.goto('/');
  await page.waitForTimeout(1000);
  const checkNowButton = page.getByRole('button', { name: /check now/i });
  await checkNowButton.click();
  await page.waitForTimeout(3000);
}

async function openMessageActions(page: Page, messageText: string) {
  const bubble = page.locator('.message-sent, .message-received').filter({ hasText: messageText }).first();
  await expect(bubble).toBeVisible({ timeout: 60_000 });
  await bubble.click({ button: 'right' });

  const modalHeading = page.getByRole('heading', { name: /message/i });
  await expect(modalHeading).toBeVisible({ timeout: 10_000 });
  return modalHeading;
}

test('ping pong extended: reply, react, deep link', async ({ browser, baseURL }) => {
  const contextOptions = baseURL ? { baseURL } : undefined;

  const contextA: BrowserContext = await browser.newContext(contextOptions);
  const contextB: BrowserContext = await browser.newContext(contextOptions);

  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  pageA.on('console', (msg) => console.log(`[Browser A] ${msg.type()}: ${msg.text()}`));
  pageB.on('console', (msg) => console.log(`[Browser B] ${msg.type()}: ${msg.text()}`));

  const displayNameA = `Tester A ${Date.now()}`;
  const displayNameB = `Tester B ${Date.now()}`;

  const [inboxA, inboxB] = await Promise.all([
    onboardWithName(pageA, displayNameA),
    onboardWithName(pageB, displayNameB),
  ]);

  await new Promise((resolve) => setTimeout(resolve, 5000));

  await startConversation(pageA, inboxB);
  const messageFromA = `A -> B ${Date.now()}`;
  await sendMessage(pageA, messageFromA);

  await syncInbox(pageB);
  await openConversation(pageB, inboxA);
  await expect(pageB.getByText(messageFromA)).toBeVisible({ timeout: 60_000 });

  await openMessageActions(pageB, messageFromA);
  await pageB.getByRole('button', { name: /^reply$/i }).click();
  await expect(pageB.getByText(/Replying to:/i)).toBeVisible({ timeout: 10_000 });

  const replyFromB = `B reply ${Date.now()}`;
  await sendMessage(pageB, replyFromB);
  await expect(pageB.getByText(/Replying to:/i)).toBeHidden({ timeout: 10_000 });

  await expect(pageA.getByText(replyFromB)).toBeVisible({ timeout: 60_000 });
  await expect(pageA.getByText('Replying to')).toBeVisible({ timeout: 60_000 });

  await openMessageActions(pageA, replyFromB);
  await pageA.getByRole('button', { name: 'React 🔥' }).click();

  const reactedBubble = pageA.locator('.message-sent, .message-received').filter({ hasText: replyFromB }).first();
  await expect(reactedBubble.getByText('🔥')).toBeVisible({ timeout: 30_000 });

  await pageA.goto(`/u/${encodeURIComponent(inboxB)}`);
  await expect(pageA).toHaveURL(/\/chat\//, { timeout: 60_000 });
  await expect(pageA.getByPlaceholder('Type a message...')).toBeVisible({ timeout: 60_000 });

  await contextA.close();
  await contextB.close();
});
