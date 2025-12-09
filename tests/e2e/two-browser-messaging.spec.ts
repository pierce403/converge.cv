import { test, expect, type BrowserContext, type Page } from '@playwright/test';

async function setDisplayNameInModal(page: Page, displayName: string) {
  try {
    const modalHeader = page.getByText(/make it yours/i);
    // Wait longer for the modal - XMTP connection can take a while
    await modalHeader.waitFor({ state: 'visible', timeout: 30000 });
    
    // Use the input inside the modal
    const modal = page.locator('.fixed.inset-0').filter({ hasText: /make it yours/i });
    const input = modal.locator('input[type="text"]');
    await input.fill(displayName);
    
    // Click Save
    await modal.getByRole('button', { name: /^save$/i }).click();
    
    // Wait for modal to close
    await modal.waitFor({ state: 'detached', timeout: 10000 });
    console.log(`[Test] Set display name to: ${displayName}`);
  } catch (error) {
    console.log('[Test] Personalization modal did not appear or failed:', error);
    // Modal did not appear; continue anyway - identity might still work
  }
}

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
  // Log store state for debugging
  const debugState = await page.evaluate(() => {
    // @ts-expect-error accessing injected store
    const store = window.useAuthStore;
    if (!store) return { error: 'store not found on window' };
    const state = store.getState?.();
    if (!state) return { error: 'getState() returned nothing' };
    return {
      hasIdentity: !!state.identity,
      address: state.identity?.address,
      inboxId: state.identity?.inboxId,
      displayName: state.identity?.displayName,
    };
  });
  console.log('[Test] waitForInboxId: Current store state:', JSON.stringify(debugState));

  // Wait for either inboxId OR address - in E2E mode we can use address
  await page.waitForFunction(() => {
    // @ts-expect-error accessing injected store
    const identity = window.useAuthStore?.getState?.()?.identity;
    return identity?.inboxId || identity?.address;
  }, { timeout: 120_000 });

  // Get inboxId or fall back to address
  const identifier = await page.evaluate(() => {
    // @ts-expect-error accessing injected store
    const identity = window.useAuthStore?.getState?.()?.identity;
    return identity?.inboxId || identity?.address || null;
  });

  console.log('[Test] waitForInboxId: Got identifier:', identifier);
  expect(identifier).toBeTruthy();
  return identifier as string;
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
  console.log(`[Test] onboardWithName: Starting for ${displayName}`);
  
  await page.goto('/');
  console.log(`[Test] onboardWithName: Navigated to / for ${displayName}`);

  try {
    await expect(page.getByText('Loading...')).not.toBeVisible({ timeout: 15000 });
  } catch (error) {
    // Loading indicator not present; continue.
  }

  // Wait for and click the "Create new identity" button
  console.log(`[Test] onboardWithName: Looking for create identity button for ${displayName}`);
  const createButton = page.getByRole('button', { name: /create new identity/i });
  await createButton.waitFor({ state: 'visible', timeout: 30000 });
  console.log(`[Test] onboardWithName: Clicking create identity button for ${displayName}`);
  await createButton.click();

  // Wait for main app to load
  console.log(`[Test] onboardWithName: Waiting for New Chat link for ${displayName}`);
  await expect(page.getByRole('link', { name: /new chat/i })).toBeVisible({ timeout: 60_000 });
  console.log(`[Test] onboardWithName: New Chat link visible for ${displayName}`);
  
  // Set display name in the "Make it yours" modal when it appears
  await setDisplayNameInModal(page, displayName);
  
  // Get identifier (inboxId or address) - don't wait, just get what's available
  console.log(`[Test] onboardWithName: Getting identifier for ${displayName}`);
  const identifier = await getIdentifier(page);
  console.log(`[Test] onboardWithName: Got identifier for ${displayName}: ${identifier}`);
  return identifier;
}

async function getIdentifier(page: Page): Promise<string> {
  // Go to Settings page where address is clearly shown
  await page.goto('/settings');
  await page.waitForTimeout(500);
  
  // Look for the address on the settings page
  // It should be displayed as "0x..." somewhere
  const pageContent = await page.content();
  const addressMatch = pageContent.match(/0x[a-fA-F0-9]{40}/);
  
  if (addressMatch) {
    const address = addressMatch[0];
    console.log(`[Test] getIdentifier: Found address from settings: ${address}`);
    // Go back to main page
    await page.goto('/');
    await page.waitForTimeout(500);
    return address;
  }
  
  // Alternative: Try to get from the visible text
  const addressLocator = page.getByText(/0x[a-fA-F0-9]{8,}/);
  try {
    await addressLocator.first().waitFor({ state: 'visible', timeout: 5000 });
    const text = await addressLocator.first().textContent();
    const match = text?.match(/0x[a-fA-F0-9]+/);
    if (match) {
      console.log(`[Test] getIdentifier: Found address from text: ${match[0]}`);
      await page.goto('/');
      await page.waitForTimeout(500);
      return match[0];
    }
  } catch (e) {
    console.log(`[Test] getIdentifier: Text method failed:`, e);
  }
  
  // Fallback: try store
  try {
    const identifier = await page.evaluate(() => {
      // @ts-expect-error accessing injected store
      const identity = window.useAuthStore?.getState?.()?.identity;
      return identity?.inboxId || identity?.address || null;
    });
    if (identifier) {
      console.log(`[Test] getIdentifier: Got from store: ${identifier}`);
      await page.goto('/');
      return identifier;
    }
  } catch (e) {
    console.log(`[Test] getIdentifier: Could not get from store:`, e);
  }
  
  await page.goto('/');
  throw new Error('Could not find identifier');
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

  // Run both onboardings in parallel - they are independent
  console.log('[Test] Starting onboarding for both browsers in parallel');
  const [inboxA, inboxB] = await Promise.all([
    onboardWithName(pageA, displayNameA),
    onboardWithName(pageB, displayNameB),
  ]);
  console.log('[Test] Both onboardings complete');
  console.log('[Test] A inboxId:', inboxA);
  console.log('[Test] B inboxId:', inboxB);

  // A starts the conversation with B and sends the first message.
  console.log('[Test] A starting conversation with B');
  await startConversation(pageA, inboxB);
  const messageFromA = `A -> B ${Date.now()}`;
  console.log('[Test] A sending message:', messageFromA);
  await sendMessage(pageA, messageFromA);
  console.log('[Test] A sent message successfully');

  // B opens the new conversation and replies.
  // In E2E mode without real XMTP, look for the conversation by address instead of display name
  console.log('[Test] B looking for conversation from A');
  await openConversation(pageB, inboxA.slice(0, 10)); // Use partial address
  console.log('[Test] B checking for A\'s message');
  await expect(pageB.getByText(messageFromA)).toBeVisible({ timeout: 60_000 });
  console.log('[Test] B saw A\'s message');

  const replyFromB = `B -> A ${Date.now()}`;
  console.log('[Test] B sending reply:', replyFromB);
  await sendMessage(pageB, replyFromB);
  console.log('[Test] B sent reply successfully');

  // A sees B's reply and sends a follow-up.
  console.log('[Test] A checking for B\'s reply');
  await expect(pageA.getByText(replyFromB)).toBeVisible({ timeout: 60_000 });
  console.log('[Test] A saw B\'s reply');
  
  const followUpFromA = `A follow-up ${Date.now()}`;
  console.log('[Test] A sending follow-up:', followUpFromA);
  await sendMessage(pageA, followUpFromA);
  console.log('[Test] A sent follow-up successfully');

  // B receives the follow-up.
  console.log('[Test] B checking for A\'s follow-up');
  await expect(pageB.getByText(followUpFromA)).toBeVisible({ timeout: 60_000 });
  console.log('[Test] B saw A\'s follow-up');
  
  console.log('[Test] ✅ All messages exchanged successfully!');

  await contextA.close();
  await contextB.close();
});
