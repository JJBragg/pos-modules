// Checks for two board cards fixed on 4 Nov 2026:
//   [Feature] A ticket cannot be moved back to New
//   [Improvement] A lost attachment is styled like ordinary text
// The unit tests cover the command; these cover the three places an agent
// actually meets the change — the board, the ticket sidebar, and the thread.
import { test, expect, Page } from '@playwright/test';
import { contextFor, desk, liquid, newTicket, ticketField, unique, users } from './helpers';

const columnOf = (page: Page, id: string) => page.evaluate((id) => document.querySelector(`.pos-support-card[data-ticket-id="${id}"]`)?.closest('.pos-support-column')?.getAttribute('data-status-key') || null, id);

const setStatus = (ticketId: string, key: string) => liquid(`{% liquid
  function t = 'modules/support/queries/tickets/find', id: '${ticketId}', number: null, member: null
  assign actor = { "type": "system", "id": null, "member": null }
  function r = 'modules/support/commands/tickets/change_status', ticket: t, status_key: '${key}', actor: actor
  assign out = { "valid": null }
  assign out.valid = r.valid
  echo out | json | html_safe
%}`);

test('a started card can be dragged back onto the New column', async ({ browser }) => {
  const t = await newTicket('New board');
  const id = t.ticket.id;
  expect(setStatus(id, 'progress').valid, 'the ticket starts in a working status').toBe(true);

  const { context, page } = await contextFor(browser, users.superadmin);
  await page.goto(desk('/support-desk/board'));
  await expect.poll(() => columnOf(page, id), { timeout: 20000 }).toBe('progress');

  await page.dragAndDrop(`.pos-support-card[data-ticket-id="${id}"]`, '.pos-support-column[data-status-key="new"] [data-cards]');
  await expect.poll(() => columnOf(page, id), { timeout: 20000 }).toBe('new');
  await expect.poll(() => ticketField(id, 'category'), { timeout: 20000 }).toBe('new');
  await context.close();
});

test('choosing New in the sidebar saves, and takes the rest of the form with it', async ({ browser }) => {
  // The bug this guards: change_status refused New, and every later step in
  // commands/tickets/apply_form is gated on result.valid, so a tag edited in
  // the same save was silently discarded along with the status.
  const t = await newTicket('New sidebar');
  expect(setStatus(t.ticket.id, 'progress').valid).toBe(true);

  const { context, page } = await contextFor(browser, users.superadmin);
  await page.goto(desk(`/support-desk/tickets/${t.ticket.id}`));
  await expect(page.locator('#pos-support-side-status')).toHaveCount(1);

  await page.fill('#pos-support-side-tags', 'back-to-new');
  await page.selectOption('#pos-support-side-status', 'new');
  await expect(page.locator('.pos-toast').last()).toContainText('Ticket updated.', { timeout: 30000 });

  await expect.poll(() => ticketField(t.ticket.id, 'category'), { timeout: 30000 }).toBe('new');
  await expect.poll(() => ticketField(t.ticket.id, 'tags'), { timeout: 30000 }).toEqual(['back-to-new']);
  await context.close();
});

test('an attachment we failed to store is marked as lost, not as metadata', async ({ browser }) => {
  const t = await newTicket('Lost file');
  const filename = `${unique('quarterly-report')}.pdf`;
  // An attachment row whose file never stored: what the inbound path leaves
  // behind when the upload fails.
  liquid(`{% liquid
  graphql m = 'modules/support/messages/search', ticket_id: '${t.ticket.id}', limit: 1
  assign message_id = m.records.results.first.id
  assign rows = []
  assign row = { "table": "modules/support/attachment" }
  assign row.properties = { "filename": "${filename}", "content_type": "application/pdf", "size": 4718592 }
  assign row.properties.message_id = message_id
  assign row.properties.ticket_id = '${t.ticket.id}'
  assign rows << row
  graphql _ = 'modules/support/records/create_many', records: rows
  echo '{}'
%}`);

  const { context, page } = await contextFor(browser, users.superadmin);
  await page.goto(desk(`/support-desk/tickets/${t.ticket.id}`));
  const lost = page.locator('.pos-support-attachment-lost', { hasText: filename });
  await expect(lost, 'the lost file takes the warning class').toHaveCount(1);
  await expect(lost).toContainText('ask the customer to resend');
  // the warning icon, not the paperclip the stored files carry
  await expect(lost.locator('use[href="#psi-triangle-alert"]')).toHaveCount(1);
  await context.close();
});
