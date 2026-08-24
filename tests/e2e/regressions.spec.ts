import { test, expect, type Page } from '@playwright/test';

test.describe('Regressions', () => {

    // Helper to handle either the required first-run editor or a later reminder.
    async function handleOnboardingModal(page: Page) {
        try {
            console.log('Waiting for onboarding modal...');
            const modalHeader = page.getByText(/choose your inbox profile|make it yours/i);
            // Wait up to 20s for it to appear
            await modalHeader.waitFor({ state: 'visible', timeout: 20000 });

            if (await modalHeader.isVisible()) {
                console.log('Modal visible, continuing with the generated profile...');
                const continueButton = page.getByRole('button', { name: /continue|don't remind me again/i });
                await continueButton.click();
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

        const createInbox = page.getByRole('button').filter({
            has: page.getByText('Create new Converge inbox', { exact: true }),
        });
        await expect(createInbox).toBeVisible({ timeout: 30000 });
        await createInbox.click();

        // Explicit creation holds the main UI behind the profile editor.
        await handleOnboardingModal(page);

        // Wait for the main UI to be ready (Layout mounted)
        await expect(page.getByRole('link', { name: /new chat/i })).toBeVisible({ timeout: 30000 });
    });

    test('active identity menu exposes only core profile actions', async ({ page }) => {
        const profileMenu = page.getByRole('button', { name: /open profile menu/i });
        await expect(profileMenu).toBeVisible();
        await profileMenu.click();

        await expect(page.getByRole('menuitem', { name: /profile & settings/i })).toBeVisible();
        await expect(page.getByRole('menuitem', { name: /contacts/i })).toBeVisible();
        await expect(page.getByRole('menuitem', { name: /copy inbox id/i })).toBeVisible();
        await expect(page.getByRole('menuitem', { name: /create new inbox|switch inbox/i })).toHaveCount(0);

        await page.getByRole('menuitem', { name: /contacts/i }).click();
        await expect(page).toHaveURL(/\/contacts$/);
        await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();
    });
});
