// Custom dropdowns everywhere (Project 28: "Custom dropdowns everywhere"):
// no browser-default select is left on a desk page; one dropdown of each
// kind works: a property (Status on the ticket page), an action (Saved
// replies), a searchable list (Pick existing staff), the list stays on
// screen, and on a phone it opens as a bottom sheet.
import { test, expect, Page } from '@playwright/test';
import { contextFor, desk, newTicket, unique, users } from './helpers';

// selects that are still the browser's own control on the current page
const nativeSelects = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll('select'))
  .filter((s) => !s.multiple && !s.classList.contains('pos-support-richselect-native'))
  .map((s) => s.id || s.name));

test('D1. no browser-default dropdown is left on the desk pages', async ({ browser }) => {
  const { ticket } = await newTicket('E2E dropdowns pages');
  const { context, page } = await contextFor(browser, users.superadmin);
  const pages = [
    '/support-desk?view=all_open&layout=list',
    '/support-desk/board',
    `/support-desk/tickets/${ticket.id}`,
    '/support-desk/settings/team',
    '/support-desk/settings/departments',
    '/support-desk/settings/statuses',
    '/support-desk/settings/sla',
    '/support-desk/settings/saved-replies',
    '/support-desk/settings/branding',
    '/support-desk/settings/email',
  ];
  for (const p of pages) {
    await page.goto(desk(p));
    expect(await nativeSelects(page), p).toEqual([]);
  }
  await context.close();
});

test('D2. Status on the ticket page shows status chips and saves the choice', async ({ browser }) => {
  const { ticket } = await newTicket('E2E dropdown status');
  const { context, page } = await contextFor(browser, users.superadmin);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(desk(`/support-desk/tickets/${ticket.id}`));
  const status = page.getByRole('combobox', { name: 'Status', exact: true });
  await expect(status.locator('.pos-support-status')).toBeVisible();
  await expect(page.locator('#pos-support-side-status')).toBeHidden();

  await status.click();
  const list = page.getByRole('listbox', { name: 'Status', exact: true });
  await expect(list.locator('.pos-support-status').first()).toBeVisible();
  // the list is laid over the page and stays inside the window
  const box = await page.locator('.pos-support-richselect-pop').boundingBox();
  expect(box && box.y + box.height).toBeLessThanOrEqual(900);

  const label = await page.locator('#pos-support-side-status option[value="hold"]').textContent();
  await list.getByRole('option', { name: label!.trim() }).click();
  await expect(status).toHaveAttribute('aria-expanded', 'false');
  await expect(status).toBeFocused();
  await expect(status).toContainText(label!.trim());
  // autosave stored it: after a reload the select still holds the new status
  await expect.poll(async () => {
    await page.reload();
    return page.locator('#pos-support-side-status').inputValue();
  }, { timeout: 20000 }).toBe('hold');
  await context.close();
});

test('D3. Saved replies is an action: choosing inserts the text and the dropdown goes back to its prompt', async ({ browser }) => {
  const { ticket } = await newTicket('E2E dropdown saved');
  const { context, page } = await contextFor(browser, users.superadmin);
  const replyName = unique('E2E dropdown reply');
  await page.goto(desk('/support-desk/settings/saved-replies'));
  await page.fill('#sr-title', replyName);
  await page.fill('#sr-body', `Text of ${replyName}.`);
  await page.click('form:has(#sr-title) button[type=submit]');
  await expect(page.locator('.pos-support-plain-list')).toContainText(replyName);

  await page.goto(desk(`/support-desk/tickets/${ticket.id}`));
  const saved = page.getByRole('combobox', { name: 'Saved reply' });
  // the prompt reads as a placeholder and is not one of the choices
  await expect(saved.locator('.pos-support-richselect-prompt')).toBeVisible();
  await saved.click();
  const list = page.getByRole('listbox', { name: 'Saved reply' });
  await expect(list.locator('.pos-support-richselect-prompt')).toHaveCount(0);
  await list.getByRole('option', { name: replyName }).click();
  await expect(page.locator('#pos-support-body')).toHaveValue(new RegExp(`Text of ${replyName}`));
  await expect(saved.locator('.pos-support-richselect-prompt')).toBeVisible();
  await context.close();
});

test('D4. Pick existing staff can be searched by email and says when nothing matches', async ({ browser }) => {
  const { context, page } = await contextFor(browser, users.superadmin);
  await page.goto(desk('/support-desk/settings/team'));
  const emails = await page.locator('#tm-pick option:not([value=""])').evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
  test.skip(emails.length === 0, 'no staff candidates on this instance');

  const pick = page.getByRole('combobox', { name: /Pick from your staff/ });
  await pick.click();
  const search = page.locator('.pos-support-richselect-search');
  await expect(search).toBeFocused();
  await search.fill(emails[0]);
  const list = page.locator('.pos-support-richselect-pop [role="listbox"]');
  await expect(list.locator('[role="option"]:visible')).toHaveCount(emails.filter((e) => e.includes(emails[0])).length);
  await page.keyboard.press('Enter');
  // choosing fills the email field, as the plain select did
  await expect(page.locator('[data-support-pick-target]')).toHaveValue(emails[0]);

  await pick.click();
  await page.locator('.pos-support-richselect-search').fill('zz-no-such-person-zz');
  await expect(page.locator('.pos-support-richselect-empty')).toBeVisible();
  await expect(page.locator('.pos-support-richselect-empty')).toHaveText('No matches');
  await page.keyboard.press('Escape');
  await expect(page.locator('.pos-support-richselect-pop')).toHaveCount(0);
  await expect(pick).toBeFocused();
  await context.close();
});

test('D5. on a phone the list opens as a bottom sheet with full-height rows', async ({ browser }) => {
  const { ticket } = await newTicket('E2E dropdown sheet');
  const { context, page } = await contextFor(browser, users.superadmin, { viewport: { width: 390, height: 800 }, hasTouch: true });
  await page.goto(desk(`/support-desk/tickets/${ticket.id}`));
  const status = page.getByRole('combobox', { name: 'Status', exact: true });
  await status.scrollIntoViewIfNeeded();
  await status.tap();
  const pop = page.locator('.pos-support-richselect-pop');
  await expect(pop).toHaveClass(/pos-support-richselect-sheet/);
  const sheet = await pop.boundingBox();
  expect(sheet!.width).toBeGreaterThanOrEqual(388);
  expect(Math.round(sheet!.y + sheet!.height)).toBe(800);
  await expect(pop.locator('.pos-support-richselect-title')).toHaveText('Status');
  const row = await pop.getByRole('option').first().boundingBox();
  expect(row!.height).toBeGreaterThanOrEqual(44);
  // tapping outside the sheet closes it without choosing
  await page.locator('.pos-support-richselect-backdrop').tap({ position: { x: 20, y: 20 } });
  await expect(pop).toHaveCount(0);
  await context.close();
});
