import { test, expect, type Page } from '@playwright/test';

test.describe('Regressions', () => {

    // Helper to handle the "Make it yours" modal if it appears
    async function handleOnboardingModal(page: Page) {
        try {
            console.log('Waiting for onboarding modal...');
            const modalHeader = page.getByText('Make it yours');
            // Wait up to 20s for it to appear
            await modalHeader.waitFor({ state: 'visible', timeout: 20000 });

            if (await modalHeader.isVisible()) {
                console.log('Modal visible, dismissing forever...');
                // Click "Don't remind me again" to ensure it doesn't come back
                await page.getByText("Don't remind me again").click();
                // Wait for the overlay to disappear
                await page.locator('.fixed.inset-0.bg-black\\/70').waitFor({ state: 'detached', timeout: 10000 });
                console.log('Onboarding modal dismissed');
            }
        } catch (e) {
            console.log('Onboarding modal did not appear within 20s');
        }
    }

    test.beforeEach(async ({ page }) => {
        // Enable browser logs for debugging
        page.on('console', msg => console.log(`BROWSER: ${msg.text()}`));

        // 1. Navigate to root
        await page.goto('/');

        // Wait for initial auth check loading to finish
        await expect(page.getByText('Loading...')).not.toBeVisible({ timeout: 15000 });

        // Handle "Create new identity" if we are on the landing page
        const createIdentityButton = page.getByRole('button', { name: 'Create new identity' });
        if (await createIdentityButton.isVisible()) {
            console.log('Clicking Create new identity');
            await createIdentityButton.click();

            // Wait for the creation process to finish
            await expect(page.getByText('Creating your new inbox…')).not.toBeVisible({ timeout: 30000 });
        }

        // Wait for the main UI to be ready (Layout mounted)
        await expect(page.getByRole('link', { name: /new chat/i })).toBeVisible({ timeout: 30000 });

        // Handle potential "Make it yours" modal which appears over the Layout
        await handleOnboardingModal(page);
    });

    test('address formatting consistency', async ({ page }) => {
        // 2. Go to New Chat
        await page.getByRole('link', { name: /new chat/i }).click();
        await expect(page).toHaveURL(/\/new-chat/);

        // 3. Enter address WITH 0x
        const validAddress = '0x1234567890123456789012345678901234567890';
        const addressInput = page.getByLabel('Ethereum Address or ENS Name');
        await addressInput.fill(validAddress);

        // 4. Start Chat
        const startChatButton = page.getByRole('button', { name: /start chat/i });
        await expect(startChatButton).toBeEnabled();
        await startChatButton.click();
        await page.waitForURL(/\/chat\//);

        // 5. Open Contact Details
        // The header contains a button with the contact name/address.
        // We look for a button that contains part of the address or "0x".
        const headerButton = page.locator('header button').filter({ hasText: /0x/i }).first();
        await expect(headerButton).toBeVisible();
        await headerButton.click();

        // 6. Check Address Display
        // Use text to find the modal since it might not have role="dialog"
        const modalHeader = page.getByText('Contact Details');
        await expect(modalHeader).toBeVisible();

        // Scope to the modal container (parent of the header)
        const modal = page.locator('.fixed.inset-0').locator('.bg-primary-900');

        // Check for the address in the modal
        // It is in a font-mono span. We get all of them and check.
        const addressDisplays = modal.locator('.font-mono');
        const count = await addressDisplays.count();
        console.log(`Found ${count} mono elements`);

        let foundCorrect = false;
        let foundDouble = false;

        for (let i = 0; i < count; ++i) {
            const text = await addressDisplays.nth(i).innerText();
            console.log(`Address displayed: ${text}`);
            if (text === validAddress) foundCorrect = true;
            if (text === `0x${validAddress}`) foundDouble = true; // 0x0x...
        }

        expect(foundDouble, 'Found double-prefixed address (0x0x...)').toBe(false);
        expect(foundCorrect, 'Did not find correctly formatted address').toBe(true);

        // 7. Test Refresh Button State
        const refreshButton = modal.getByRole('button', { name: /refresh/i });
        await expect(refreshButton).toBeVisible();
        await refreshButton.click();

        // Expect it to change state (text becomes "Refreshing...")
        await expect(modal.getByText(/refreshing/i)).toBeVisible();
    });

    test('contact card visual regression', async ({ page }) => {
        // Setup is handled by beforeEach

        // 2. Go to New Chat to get a contact
        await page.getByRole('link', { name: /new chat/i }).click();
        const validAddress = '0xabcdef1234567890abcdef1234567890abcdef12';
        await page.getByLabel('Ethereum Address or ENS Name').fill(validAddress);
        await page.getByRole('button', { name: /start chat/i }).click();

        // 3. Open Contact Card
        // Wait for header to be ready
        const headerButton = page.locator('header button').filter({ hasText: /0x/i }).first();
        await expect(headerButton).toBeVisible();
        await page.waitForTimeout(500); // Stability wait
        await headerButton.click({ force: true });

        const modalHeader = page.getByText('Contact Details');
        await expect(modalHeader).toBeVisible();
        const modal = page.locator('.fixed.inset-0').locator('.bg-primary-900');

        // 4. Check Visual Elements
        await expect(modal.getByText('Inbox ID')).toBeVisible();
        await expect(modal.getByText('Known Connected Identities')).toBeVisible();
        await expect(modal.getByRole('button', { name: 'Message' })).toBeVisible();

        // Check for "Show QR Code" button
        await expect(modal.getByRole('button', { name: 'Show QR Code' })).toBeVisible();
    });

    test('multi-identity messaging with inbox switcher', async ({ page }) => {
        // 1. Get Identity 1 inbox ID directly from the store (avoid UI timing issues)
        // Wait for useAuthStore to be exposed and inboxId to be populated
        await page.waitForFunction(() => {
            // @ts-expect-error accessing global store
            return window.useAuthStore?.getState?.()?.identity?.inboxId;
        }, { timeout: 10000 });

        const identity1InboxId = await page.evaluate(() => {
            // @ts-expect-error accessing global store
            return window.useAuthStore?.getState?.()?.identity?.inboxId || null;
        });
        console.log('Identity 1:', identity1InboxId);
        expect(identity1InboxId).toBeTruthy();

        // 2. Create Identity 2 via InboxSwitcher
        const switcherButton = page.getByRole('button', { name: /current inbox/i });
        await expect(switcherButton).toBeVisible();
        await page.waitForTimeout(500);
        await switcherButton.click({ force: true });

        const createButton = page.getByRole('menuitem', { name: /create ephemeral identity/i });
        await createButton.click();

        // Wait for reload/navigation
        await expect(page.getByRole('link', { name: /new chat/i })).toBeVisible({ timeout: 30_000 });

        // Reload to ensure identity state is fully synced from storage
        await page.reload();
        await expect(page.getByRole('link', { name: /new chat/i })).toBeVisible({ timeout: 30_000 });

        // Handle modal for the new identity
        await handleOnboardingModal(page);

        // Verify we are on a new identity (read directly from store)
        const identity2InboxId = await page.evaluate(() => {
            // @ts-expect-error accessing global store
            return window.useAuthStore?.getState?.()?.identity?.inboxId || null;
        });
        console.log('Identity 2:', identity2InboxId);

        expect(identity1InboxId).not.toBe(identity2InboxId);
        expect(identity2InboxId).toBeTruthy();

        // 3. Send message from Id 2 to Id 1
        await page.getByRole('link', { name: /new chat/i }).click();
        await page.getByLabel('Ethereum Address or ENS Name').fill(identity1InboxId);
        await page.getByRole('button', { name: /start chat/i }).click();

        const messageText = `Hello from Id2 ${Date.now()}`;
        const composer = page.getByPlaceholder('Type a message...');
        await composer.fill(messageText);
        await composer.press('Enter');

        // Verify sent
        await expect(page.getByText(messageText)).toBeVisible();

        // 4. Switch back to Identity 1
        await switcherButton.click();
        // Find the button for Identity 1 in the list
        // It should be in the "On this device" list
        // The button contains the inbox ID or part of it
        const switchBackBtn = page.getByRole('menuitem').filter({ hasText: identity1InboxId }).first();
        await switchBackBtn.click();

        // Wait for reload
        await expect(page.getByRole('link', { name: /new chat/i })).toBeVisible({ timeout: 30_000 });

        // Handle modal if it appears again (unlikely if saved, but good to be safe)
        await handleOnboardingModal(page);

        // 5. Verify message received
        // It should be in the chat list
        const chatLink = page.getByRole('link').filter({ hasText: messageText }).first();
        // If not in list preview, maybe check for the peer address (Id 2)
        // But let's try to find the conversation
        await expect(chatLink).toBeVisible({ timeout: 10_000 });
        await chatLink.click();

        await expect(page.getByText(messageText)).toBeVisible();

        // 6. Reply from Id 1
        const replyText = `Reply from Id1 ${Date.now()}`;
        await composer.fill(replyText);
        await composer.press('Enter');
        await expect(page.getByText(replyText)).toBeVisible();

        // 7. Switch back to Identity 2
        await switcherButton.click();
        const switchToId2Btn = page.getByRole('menuitem').filter({ hasText: identity2InboxId }).first();
        await switchToId2Btn.click();

        await expect(page.getByRole('link', { name: /new chat/i })).toBeVisible({ timeout: 30_000 });
        await handleOnboardingModal(page);

        // 8. Verify reply received
        const chatLink2 = page.getByRole('link').filter({ hasText: replyText }).first();
        await expect(chatLink2).toBeVisible({ timeout: 10_000 });
        await chatLink2.click();
        await expect(page.getByText(replyText)).toBeVisible();
    });
});
