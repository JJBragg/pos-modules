// Browser checks for the design review (Gyöngy, 6 Nov 2026), groups A–H.
// The unit tests (department_colors, avatars, status_icons, branding) cover
// the helpers and commands behind them.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
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

test('E. filter dropdowns show markers, work by keyboard, and Reset all clears every filter', async ({ browser }) => {
  const { context, page } = await contextFor(browser, users.superadmin);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(desk('/support-desk?view=all_open&layout=list&group=status'));
  const priority = page.getByRole('combobox', { name: 'Priority' });
  await expect(priority).toBeVisible();
  await expect(page.locator('#pos-support-priority')).toBeHidden();

  // keyboard: focus, open with ArrowDown, move, choose with Enter
  await priority.focus();
  await page.keyboard.press('ArrowDown');
  await expect(priority).toHaveAttribute('aria-expanded', 'true');
  const list = page.getByRole('listbox', { name: 'Priority' });
  await expect(list.getByRole('option')).toHaveCount(5);
  await expect(list.getByRole('option').nth(1)).toContainText('Urgent');
  await expect(list.locator('.pos-support-priority-p0')).toHaveCount(1);

  // the open list passes axe
  const axe = await new AxeBuilder({ page }).include('.pos-support-toolbar').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);

  await page.keyboard.press('ArrowDown');
  await expect(priority).toHaveAttribute('aria-activedescendant', /opt-1$/);
  await Promise.all([page.waitForURL(/priority=p0/), page.keyboard.press('Enter')]);
  // the chosen value keeps its marker in the closed control
  await expect(page.getByRole('combobox', { name: 'Priority' }).locator('.pos-support-priority-p0')).toBeVisible();

  // department filter with its tag; Escape closes without choosing
  const department = page.getByRole('combobox', { name: 'Department' });
  await department.click();
  await expect(page.getByRole('listbox', { name: 'Department' }).locator('.pos-support-dept-label').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(department).toHaveAttribute('aria-expanded', 'false');
  const option = page.getByRole('listbox', { name: 'Department' }).getByRole('option').nth(1);
  await department.click();
  await Promise.all([page.waitForURL(/department_id=\d+/), option.click()]);

  // Reset all filters clears priority and department, keeps the view
  const reset = page.getByRole('link', { name: 'Reset all filters' });
  await expect(reset).toBeVisible();
  await reset.click();
  await expect(page).not.toHaveURL(/priority=|department_id=/);
  await expect(page.getByRole('link', { name: 'Reset all filters' })).toHaveCount(0);
  await context.close();
});

test('E. without JavaScript the plain selects still filter', async ({ browser }) => {
  const { context, page } = await contextFor(browser, users.superadmin, { javaScriptEnabled: false });
  await page.goto(desk('/support-desk?view=all_open&layout=list&group=status'));
  await expect(page.locator('#pos-support-priority')).toBeVisible();
  await page.selectOption('#pos-support-priority', 'p1');
  await Promise.all([page.waitForURL(/priority=p1/), page.click('[data-support-filter-button]')]);
  await context.close();
});
