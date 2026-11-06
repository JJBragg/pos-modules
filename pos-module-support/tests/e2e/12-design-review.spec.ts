// Browser checks for the design review (Gyöngy, 6 Nov 2026), groups A–H.
// The unit tests (department_colors, avatars, status_icons, branding) cover
// the helpers and commands behind them.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { contextFor, desk, liquid, users } from './helpers';

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
    // handoff 3.34: a floating tooltip with name and count, dismissable with Escape
    await page.locator('.pos-support-rail-items a[href*="view=needs_reply"]').hover();
    await expect(page.locator('.pos-support-rail-tip')).toBeVisible();
    await expect(page.locator('.pos-support-rail-tip')).toContainText(/Needs reply · \d+/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.pos-support-rail-tip')).toBeHidden();

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

test('G. card hover grows the background with a brand ring; overdue: the red "!" opens to "! Overdue" with a red ring', async ({ browser }) => {
  const { context, page } = await contextFor(browser, users.superadmin);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(desk('/support-desk/board'));
  const overdue = page.locator('.pos-support-card-overdue').first();
  await expect(overdue).toBeVisible();
  const badge = overdue.locator('.pos-support-sla-overdue');
  // at rest: a 1rem red dot, the word still in the DOM for screen readers
  expect(Math.round((await badge.boundingBox())!.width)).toBeLessThanOrEqual(17);
  await expect(badge).toContainText('Overdue');
  const card = (await overdue.boundingBox())!;
  const dot = (await badge.boundingBox())!;
  expect(dot.x + dot.width).toBeGreaterThan(card.x + card.width);  // pinned to the edge, sticking out

  await overdue.locator('.pos-support-card-title').hover();
  await expect.poll(async () => (await badge.boundingBox())!.width).toBeGreaterThan(50);
  const ring = await overdue.evaluate((el) => getComputedStyle(el, '::before').boxShadow);
  expect(ring).toMatch(/3px/);
  // the content does not move or scale; only the background layer grows
  expect(await overdue.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
  await expect.poll(() => overdue.evaluate((el) => getComputedStyle(el, '::before').inset)).not.toBe('-1px');

  // keyboard focus opens the badge as well
  await page.mouse.move(5, 5);
  await overdue.locator('.pos-support-card-title a').focus();
  await expect.poll(async () => (await badge.boundingBox())!.width).toBeGreaterThan(50);

  // the drag handle appears on hover
  const plain = page.locator('.pos-support-card:not(.pos-support-card-overdue)').first();
  await plain.locator('.pos-support-card-title').hover();
  await expect.poll(() => plain.locator('.pos-support-card-grip').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await context.close();
});

test('G. reduced motion: no ping animation and no transitions on cards', async ({ browser }) => {
  const { context, page } = await contextFor(browser, users.superadmin, { reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(desk('/support-desk/board'));
  const badge = page.locator('.pos-support-card-overdue .pos-support-sla-overdue').first();
  expect(await badge.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  expect(await page.locator('.pos-support-card').first().evaluate((el) => getComputedStyle(el, '::before').transitionDuration)).toMatch(/^0s/);
  await context.close();
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

// design handoff (Gyöngy's v3): brand colour, test themes, brand block, side panel dropdowns
test('I. a too-light host brand is shifted to an accessible shade; semantic colours never follow the brand', async ({ browser }) => {
  const { context, page } = await contextFor(browser, users.superadmin);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(desk('/support-desk/board?host_theme=sample-host-3'));
  const token = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--pos-color-button-primary-background').trim());
  expect(await rgbOf(page, await token())).toBe(await rgbOf(page, '#604fb9'));
  // 3.4: the E2E department marker (Violet, close to this brand) and the status chips keep their own colours
  const violet = await page.locator('.pos-support-rail-items [data-dept-color="2"]').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await rgbOf(page, violet)).toBe(await rgbOf(page, '#805db8'));
  const chip = await page.locator('.pos-support-status-open').first().evaluate((el) => getComputedStyle(el).color);
  expect(await rgbOf(page, chip)).toBe(await rgbOf(page, '#175890'));

  await page.goto(desk('/support-desk/settings/branding'));
  await expect(page.locator('[data-support-brand-shifted]')).toContainText('#8b7cf6');
  await expect(page.locator('[data-support-brand-shifted]')).toContainText('#604fb9');
  // a host without a logo: the support icon, framed and recoloured, with the app name and "Support desk"
  await expect(page.locator('#pos-support-rail .pos-support-brand-frame.pos-support-brand-recolour')).toBeVisible();
  await expect(page.locator('#pos-support-rail .pos-support-brand-sub')).toHaveText('Support desk');

  // a brand that passes is not shifted, and the host stylesheet keeps its own values
  await page.goto(desk('/support-desk/board?host_theme=pos'));
  expect(await rgbOf(page, await token())).toBe(await rgbOf(page, '#23559f'));
  await expect(page.locator('style[data-support-brand-tokens]')).toHaveCount(0);
  // pOS shows the support icon framed in its own colours
  await expect(page.locator('#pos-support-rail .pos-support-brand-frame')).toBeVisible();
  await expect(page.locator('#pos-support-rail .pos-support-brand-recolour')).toHaveCount(0);
  await page.goto(desk('/support-desk/board?host_theme=default'));
  await context.close();
});

test('I. the Branding page colour override recolours the desk', async ({ browser }) => {
  const { context, page } = await contextFor(browser, users.superadmin);
  const form = page.locator('form:has(#br-use-host)');
  try {
    await page.goto(desk('/support-desk/settings/branding'));
    await page.fill('#br-theme', '#046b55');
    await form.locator('button[type=submit]').click();
    await expect(page.locator('#br-theme')).toHaveValue('#046b55');
    await page.goto(desk('/support-desk'));
    const value = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--pos-color-button-primary-background').trim());
    expect(await rgbOf(page, value)).toBe(await rgbOf(page, '#046b55'));
  } finally {
    await page.goto(desk('/support-desk/settings/branding'));
    await page.fill('#br-theme', '');
    await page.locator('#br-use-host').check();
    await form.locator('button[type=submit]').click();
    await expect(page.locator('#br-use-host')).toBeChecked();
    await context.close();
  }
});

test('I. the ticket side panel uses the marker dropdowns; Reset all filters has a tooltip and puts focus on search', async ({ browser }) => {
  const ticket = liquid(`{% liquid
  graphql r = 'modules/support/tickets/search', limit: 1
  assign out = { "id": null }
  assign out.id = r.records.results.first.id
  echo out | json | html_safe
%}`);
  const { context, page } = await contextFor(browser, users.superadmin);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(desk(`/support-desk/tickets/${ticket.id}`));
  const department = page.getByRole('combobox', { name: 'Department' });
  await expect(department.locator('.pos-support-dept-label')).toBeVisible();
  // the field's label opens the dropdown
  await page.locator('label', { hasText: 'Department' }).first().click();
  await expect(department).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');

  await page.goto(desk('/support-desk?view=all_open&priority=p1'));
  const reset = page.getByRole('link', { name: 'Reset all filters' });
  await reset.hover();
  await expect.poll(() => reset.evaluate((el) => getComputedStyle(el, '::after').opacity)).toBe('1');
  await page.keyboard.press('Escape');
  await expect.poll(() => reset.evaluate((el) => getComputedStyle(el, '::after').opacity)).toBe('0');
  await reset.click();
  await expect(page).not.toHaveURL(/priority=/);
  await expect(page.locator('[data-support-search]')).toBeFocused();
  await context.close();
});
