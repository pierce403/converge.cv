import { expect, test } from '@playwright/test';

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4XcAAAAASUVORK5CYII=',
  'base64'
);

async function finishProfile(page: import('@playwright/test').Page, name: string) {
  const dialog = page.getByRole('dialog', { name: /choose your inbox profile/i });
  await expect(dialog).toBeVisible();
  const nameInput = dialog.getByLabel('Display Name');
  await expect(nameInput).toHaveValue(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  await nameInput.fill(name);
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: tinyPng,
  });
  await expect(dialog.getByAltText('Avatar preview')).toBeVisible();
  await dialog.getByRole('button', { name: /save and continue/i }).click();
  await expect(dialog).toBeHidden();
}

test('first-run profile and profile-based inbox switching', async ({ page }) => {
  await page.goto('/');
  await finishProfile(page, 'Primary Context');
  await expect(page.getByRole('link', { name: /new chat/i })).toBeVisible();

  let switcher = page.getByRole('button', { name: /inbox switcher, current inbox primary context/i });
  await expect(switcher).toBeVisible();
  await switcher.click();
  await page.getByRole('menuitem', { name: /create new inbox/i }).click();

  await finishProfile(page, 'Brand Context');
  await expect(page.getByRole('link', { name: /new chat/i })).toBeVisible();
  switcher = page.getByRole('button', { name: /inbox switcher, current inbox brand context/i });
  await switcher.click();
  await expect(page.getByRole('menuitem', { name: 'Primary Context' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Brand Context/i })).toBeVisible();

  await page.getByRole('menuitem', { name: 'Primary Context' }).click();
  await expect(
    page.getByRole('button', { name: /inbox switcher, current inbox primary context/i })
  ).toBeVisible();
});
