// Browser checks for the white-label fixes from the host-install test
// (issues #125–#129): sidebar logo choice, preview, iOS icon, manifest
// icons, the logo/colour/favicon overrides and Appearance following the
// host. branding_test covers the commands and the default name (#130).
import { test, expect } from '@playwright/test';
import { contextFor, desk, users } from './helpers';

const LIGHT = 'https://example.com/e2e-logo-light.svg';
const DARK = 'https://example.com/e2e-logo-dark.svg';
const ICON = 'https://example.com/e2e-icon-512.png';

test('BR-1 a dark sidebar shows the dark logo in light mode; host icon replaces the module icons', async ({ browser, request }) => {
  const { context, page } = await contextFor(browser, users.superadmin);
  await page.emulateMedia({ colorScheme: 'light' });
  const form = page.locator('form:has(#br-use-host)');
  try {
    await page.goto(desk('/support-desk/settings/branding'));
    await page.locator('input[name=theme_mode][value=host]').check();
    await page.locator('[data-support-appearance-save]').click();
    await expect(page.locator('[data-support-appearance-source]')).toContainText('following the host app');
    await expect(page.locator('input[name=theme_mode][value=host]')).toBeChecked();

    // one logo overridden: the page says the other still comes from the host
    await page.fill('#br-logo', LIGHT);
    await form.locator('button[type=submit]').click();
    await expect(page.locator('[data-support-mixed-logos]')).toBeVisible();

    await page.fill('#br-logo-dark', DARK);
    await page.selectOption('#br-rail-theme', 'dark');
    await page.fill('#br-icon', ICON);
    await form.locator('button[type=submit]').click();
    await expect(page.locator('[data-support-mixed-logos]')).toHaveCount(0);
    await expect(page.locator('#br-rail-theme')).toHaveValue('dark');
    await expect(page.locator('.pos-support-brand-preview .pos-support-brand-logo')).toHaveAttribute('src', DARK);

    await page.goto(desk('/support-desk'));
    await expect(page.locator('.pos-support-rail .pos-support-brand-logo').first()).toHaveAttribute('src', DARK);
    await expect(page.locator('link[rel=apple-touch-icon]')).toHaveAttribute('href', ICON);

    const manifest = await (await request.get(desk('/support-desk/manifest.json'))).json();
    expect(manifest.icons).toEqual([{ src: ICON, sizes: '512x512', type: 'image/png', purpose: 'any' }]);
  } finally {
    await page.goto(desk('/support-desk/settings/branding'));
    for (const id of ['#br-logo', '#br-logo-dark', '#br-icon']) await page.fill(id, '');
    await page.selectOption('#br-rail-theme', '');
    await page.locator('#br-use-host').check();
    await form.locator('button[type=submit]').click();
    await expect(page.locator('#br-use-host')).toBeChecked();
    await context.close();
  }
  const manifest = await (await request.get(desk('/support-desk/manifest.json'))).json();
  expect(manifest.icons.map((i: any) => i.sizes)).toEqual(['192x192', '512x512']);
});

test('BR-3 with both logos and no rail_theme, the logo follows the sidebar colour automatically', async ({ browser }) => {
  const { context, page } = await contextFor(browser, users.superadmin);
  await page.emulateMedia({ colorScheme: 'light' });
  const form = page.locator('form:has(#br-use-host)');
  const logo = page.locator('.pos-support-rail .pos-support-brand-logo').first();
  try {
    await page.goto(desk('/support-desk/settings/branding'));
    await page.fill('#br-logo', LIGHT);
    await page.fill('#br-logo-dark', DARK);
    await page.selectOption('#br-rail-theme', '');
    await form.locator('button[type=submit]').click();
    await expect(page.locator('#br-rail-theme')).toHaveValue('');

    await page.goto(desk('/support-desk'));
    await expect(logo).toHaveAttribute('data-support-logo-picked', 'light');
    await expect(logo).toHaveAttribute('src', LIGHT);

    // a host stylesheet paints the sidebar in a dark brand colour
    await page.addStyleTag({ content: '.pos-support .pos-support-rail { background: #0e5c4a !important; }' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(logo).toHaveAttribute('data-support-logo-picked', 'dark');
    await expect(logo).toHaveAttribute('src', DARK);
  } finally {
    await page.goto(desk('/support-desk/settings/branding'));
    for (const id of ['#br-logo', '#br-logo-dark']) await page.fill(id, '');
    await page.locator('#br-use-host').check();
    await form.locator('button[type=submit]').click();
    await expect(page.locator('#br-use-host')).toBeChecked();
    await context.close();
  }
});

test('BR-2 Appearance set here is reported as an override and can follow the host again', async ({ browser }) => {
  const { context, page } = await contextFor(browser, users.superadmin);
  try {
    await page.goto(desk('/support-desk/settings/branding'));
    await page.locator('input[name=theme_mode][value=light]').check();
    await page.locator('[data-support-appearance-save]').click();
    await expect(page.locator('[data-support-appearance-source]')).toContainText('set here');
    await expect(page.locator('html')).not.toHaveClass(/pos-theme-darkEnabled/);
  } finally {
    await page.locator('input[name=theme_mode][value=host]').check();
    await page.locator('[data-support-appearance-save]').click();
    await expect(page.locator('[data-support-appearance-source]')).toContainText('following the host app');
    await expect(page.locator('html')).toHaveClass(/pos-theme-darkEnabled/);
    await context.close();
  }
});
