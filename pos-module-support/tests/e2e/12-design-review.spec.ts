// Browser checks for the design review (Gyöngy, 6 Nov 2026), groups A–H.
// The unit tests (department_colors, avatars, status_icons, branding) cover
// the helpers and commands behind them.
import { test, expect } from '@playwright/test';
import { contextFor, desk, users } from './helpers';

test('F. the desktop sidebar collapses to icons, keeps accessible names and is remembered', async ({ browser }) => {
  const { context, page } = await contextFor(browser, users.superadmin);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(desk('/support-desk'));
  const shell = page.locator('[data-support-shell]');
  const toggle = page.locator('[data-support-rail-toggle] button');
  try {
    if (await shell.evaluate((el) => el.classList.contains('pos-support-rail-collapsed'))) {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const wide = (await page.locator('.pos-support-rail').boundingBox())!.width;

    await toggle.click();
    await expect(shell).toHaveClass(/pos-support-rail-collapsed/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveAccessibleName('Expand sidebar');
    const narrow = (await page.locator('.pos-support-rail').boundingBox())!.width;
    expect(narrow).toBeLessThan(80);
    expect(narrow).toBeLessThan(wide);
    // every link still has its name for screen readers, and a tooltip
    await expect(page.locator('.pos-support-rail').getByRole('link', { name: /Needs reply/ })).toBeVisible();
    await expect(page.locator('.pos-support-rail-items a[href*="view=needs_reply"]')).toHaveAttribute('title', /Needs reply/);

    // remembered: the next page renders collapsed from the server, without a flash
    await page.waitForTimeout(500);
    await page.goto(desk('/support-desk/board'));
    await expect(shell).toHaveClass(/pos-support-rail-collapsed/);
  } finally {
    if (await shell.evaluate((el) => el.classList.contains('pos-support-rail-collapsed'))) {
      await toggle.click();
      await page.waitForTimeout(500);
    }
    await context.close();
  }
});

test('F. on a phone the drawer stays and the desktop collapse button is hidden', async ({ browser }) => {
  const { context, page } = await contextFor(browser, users.superadmin);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(desk('/support-desk'));
  await expect(page.locator('[data-support-rail-toggle] button')).toBeHidden();
  await context.close();
});

// colours from color-mix / computed styles can come back as oklch(); a canvas gives rgb
const rgbOf = (page: import('@playwright/test').Page, css: string) => page.evaluate((c) => {
  const x = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
  x.fillStyle = c; x.fillRect(0, 0, 1, 1);
  return Array.from(x.getImageData(0, 0, 1, 1).data.slice(0, 3)).join(',');
}, css);

test('G. cards outline on hover and focus; overdue cards show "! Overdue" in the fixed SLA red', async ({ browser }) => {
  const { context, page } = await contextFor(browser, users.superadmin);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(desk('/support-desk/board'));
  const overdue = page.locator('.pos-support-card-overdue').first();
  await expect(overdue).toBeVisible();
  const text = overdue.locator('.pos-support-overdue-text');
  // at rest: only the "!" shows, but the word is in the accessible text
  expect((await text.boundingBox())!.width).toBeLessThanOrEqual(1);
  await expect(text).toHaveText('Overdue');

  await overdue.locator('.pos-support-card-title').hover();
  await expect.poll(async () => (await text.boundingBox())!.width).toBeGreaterThan(20);
  const outline = await overdue.evaluate((el) => getComputedStyle(el).outlineColor);
  const red = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--pos-support-sla-overdue').trim());
  expect(await rgbOf(page, outline)).toBe(await rgbOf(page, red));
  await expect.poll(() => overdue.evaluate((el) => getComputedStyle(el).transform)).not.toBe('none');

  // keyboard focus shows the pill as well
  await page.mouse.move(5, 5);
  await overdue.locator('.pos-support-card-title a').focus();
  await expect.poll(async () => (await text.boundingBox())!.width).toBeGreaterThan(20);

  // an ordinary card outlines in the brand colour
  const plain = page.locator('.pos-support-card:not(.pos-support-card-overdue)').first();
  await plain.locator('.pos-support-card-title').hover();
  const plainOutline = await plain.evaluate((el) => getComputedStyle(el).outlineColor);
  expect(await rgbOf(page, plainOutline)).not.toBe(await rgbOf(page, red));
  await context.close();
});

test('G. reduced motion: no scale; touch screens always show the Overdue pill', async ({ browser }) => {
  const { context, page } = await contextFor(browser, users.superadmin, { reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(desk('/support-desk/board'));
  const card = page.locator('.pos-support-card').first();
  await card.locator('.pos-support-card-title').hover();
  expect(await card.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
  await context.close();

  const phone = await contextFor(browser, users.superadmin, { hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  await phone.page.goto(desk('/support-desk/board'));
  const text = phone.page.locator('.pos-support-card-overdue .pos-support-overdue-text').first();
  await text.scrollIntoViewIfNeeded();
  expect((await text.boundingBox())!.width).toBeGreaterThan(20);
  await phone.context.close();
});
