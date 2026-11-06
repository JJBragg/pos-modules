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
