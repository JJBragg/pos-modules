// Browser checks for the white-label fixes from the host-install test
// (issues #125–#129): sidebar logo choice, preview, iOS icon, manifest
// icons, the logo/colour/favicon overrides and Appearance following the
// host. branding_test covers the commands and the default name (#130).
import { test, expect } from '@playwright/test';
import { choose, contextFor, desk, liquid, users } from './helpers';

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
    await choose(page, '#br-rail-theme', 'dark');
    await form.locator('button[type=submit]').click();
    await expect(page.locator('[data-support-mixed-logos]')).toHaveCount(0);
    await expect(page.locator('#br-rail-theme')).toHaveValue('dark');
    await expect(page.locator('.pos-support-brand-preview .pos-support-brand-logo')).toHaveAttribute('src', DARK);

    await page.goto(desk('/support-desk'));
    await expect(page.locator('#pos-support-rail .pos-support-brand-logo').first()).toHaveAttribute('src', DARK);

    // a host icon then wins in the sidebar (design handoff 3.20) and replaces the module icons
    await page.goto(desk('/support-desk/settings/branding'));
    await page.fill('#br-icon', ICON);
    await form.locator('button[type=submit]').click();
    await page.goto(desk('/support-desk'));
    await expect(page.locator('#pos-support-rail .pos-support-brand-logo').first()).toHaveAttribute('src', ICON);
    await expect(page.locator('link[rel=apple-touch-icon]')).toHaveAttribute('href', ICON);

    const manifest = await (await request.get(desk('/support-desk/manifest.json'))).json();
    expect(manifest.icons).toEqual([{ src: ICON, sizes: '512x512', type: 'image/png', purpose: 'any' }]);
  } finally {
    await page.goto(desk('/support-desk/settings/branding'));
    for (const id of ['#br-logo', '#br-logo-dark', '#br-icon']) await page.fill(id, '');
    await choose(page, '#br-rail-theme', '');
    await page.locator('#br-use-host').check();
    await form.locator('button[type=submit]').click();
    await expect(page.locator('#br-use-host')).toBeChecked();
    await context.close();
  }
  const manifest = await (await request.get(desk('/support-desk/manifest.json'))).json();
  expect(manifest.icons.map((i: any) => i.src)).not.toContain(ICON);
});

test('BR-3 with both logos and no rail_theme, the logo follows the sidebar colour automatically', async ({ browser }) => {
  const { context, page } = await contextFor(browser, users.superadmin);
  await page.emulateMedia({ colorScheme: 'light' });
  const form = page.locator('form:has(#br-use-host)');
  const logo = page.locator('#pos-support-rail .pos-support-brand-logo').first();
  try {
    await page.goto(desk('/support-desk/settings/branding'));
    await page.fill('#br-logo', LIGHT);
    await page.fill('#br-logo-dark', DARK);
    await choose(page, '#br-rail-theme', '');
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

// a PNG drawn in the page, so the test needs no fixture files
const png = async (page: import('@playwright/test').Page, w: number, h: number) => Buffer.from(await page.evaluate(([w, h]) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d') as CanvasRenderingContext2D; x.fillStyle = '#0e5c4a'; x.fillRect(0, 0, w, h);
  return c.toDataURL('image/png').split(',')[1];
}, [w, h]), 'base64');

test('BR-4 logos and the app icon can be uploaded; a non-square icon is refused in the browser', async ({ browser, request }) => {
  const { context, page } = await contextFor(browser, users.superadmin);
  const form = page.locator('form:has(#br-use-host)');
  try {
    await page.goto(desk('/support-desk/settings/branding'));
    await page.setInputFiles('#br-icon-file', { name: 'wide.png', mimeType: 'image/png', buffer: await png(page, 600, 300) });
    expect(await page.locator('#br-icon-file').evaluate((el: HTMLInputElement) => el.validationMessage)).toContain('square');
    await expect(page.locator('[data-support-brand-upload="icon_url"] input')).toHaveCount(0);

    await page.setInputFiles('#br-logo-file', { name: 'logo.png', mimeType: 'image/png', buffer: await png(page, 256, 64) });
    await page.setInputFiles('#br-icon-file', { name: 'icon.png', mimeType: 'image/png', buffer: await png(page, 512, 512) });
    await expect(page.locator('[data-support-brand-chosen="icon_url"]')).toContainText('icon.png');
    await expect(page.locator('#br-use-host')).not.toBeChecked();
    await form.locator('button[type=submit]').click();
    await expect(page.locator('body')).toContainText('Saved.');
    const logo = await page.locator('#br-logo').inputValue();
    const icon = await page.locator('#br-icon').inputValue();
    expect(logo).toMatch(/^https:\/\/\S+logo\.png$/);
    expect(icon).toMatch(/^https:\/\/\S+icon\.png$/);
    const served = await request.get(icon);
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toBe('image/png');
    await page.goto(desk('/support-desk'));
    // with both, the uploaded icon is the sidebar mark (design handoff 3.20)
    await expect(page.locator('#pos-support-rail .pos-support-brand-logo').first()).toHaveAttribute('src', icon);
    await expect(page.locator('link[rel=apple-touch-icon]')).toHaveAttribute('href', icon);
  } finally {
    await page.goto(desk('/support-desk/settings/branding'));
    for (const id of ['#br-logo', '#br-icon']) await page.fill(id, '');
    await page.locator('#br-use-host').check();
    await form.locator('button[type=submit]').click();
    await expect(page.locator('#br-use-host')).toBeChecked();
    await context.close();
  }
});

test('BR-5 with no host icon, an admin visit stores a monogram PNG that becomes the app icon', async ({ browser, request }) => {
  const { context, page } = await contextFor(browser, users.superadmin);
  await page.emulateMedia({ colorScheme: 'light' });
  // signing in opens the desk too; forget the stored monogram after that, so
  // the visit below has to draw one
  await page.waitForLoadState('networkidle');
  liquid(`{% function _ = 'modules/support/commands/settings/set', key: 'branding_monogram', value: null %}{% echo '{}' %}`);
  const saved = page.waitForResponse((r) => r.url().endsWith('/support-desk/settings/save') && r.request().method() === 'POST');
  await page.goto(desk('/support-desk'));
  expect((await saved).status()).toBe(204);

  await page.reload();
  const icon = await page.locator('link[rel=apple-touch-icon]').getAttribute('href');
  expect(icon).toMatch(/^https:\/\/\S+monogram\.png$/);
  expect((await request.get(icon as string)).headers()['content-type']).toMatch(/png/);
  await expect(page.locator('link[rel=icon]')).toHaveAttribute('href', icon as string);
  const manifest = await (await request.get(desk('/support-desk/manifest.json'))).json();
  expect(manifest.icons).toEqual([{ src: icon, sizes: '512x512', type: 'image/png', purpose: 'any' }]);

  // the stored signature now matches, so the next visit does not draw again
  let posted = false;
  page.on('request', (r) => { if (r.url().endsWith('/support-desk/settings/save')) posted = true; });
  await page.reload();
  await page.waitForTimeout(1500);
  expect(posted).toBe(false);
  await context.close();
});
