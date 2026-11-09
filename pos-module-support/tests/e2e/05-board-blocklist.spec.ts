// Scenarios 15–16 (tech-spec 10 §3): board drag and drop with live updates
// and the no-JS Move form; blocklist by domain and Mark as spam.
import { test, expect, Page } from '@playwright/test';
import { contextFor, desk, inbound, liquid, ticketBySubject, unique, users, waitForTicket } from './helpers';

const columnOf = (page: Page, id: string) => page.evaluate((id) => document.querySelector(`.pos-support-card[data-ticket-id="${id}"]`)?.closest('.pos-support-column')?.getAttribute('data-status-key') || null, id);

// Readiness of the page about to be opened: contextFor already loaded a desk
// page whose own subscription would count, so the flag is reset right before
// the page under test is opened, and only its sockets can set it again.
function subscribed(page: Page) {
  let confirmed = false;
  page.on('websocket', (ws) => ws.on('framereceived', (f) => { if (String(f.payload).includes('confirm_subscription')) confirmed = true; }));
  return { reset: () => { confirmed = false; }, ready: () => confirmed };
}

test('15. dragging a card changes the status and other boards and the list follow; Move to works without JavaScript', async ({ browser }) => {
  const subject = unique('E2E board');
  await inbound({ from: `${unique('customer')}@e2e.example`, to: 'e2e@support-dev.platformos.com', subject, body: 'Board me.' });
  const ticket = await waitForTicket(subject);
  liquid(`{% liquid
  function t = 'modules/support/queries/tickets/find', id: '${ticket.id}', number: null, member: null
  assign actor = { "type": "system", "id": null, "member": null }
  function r = 'modules/support/commands/tickets/change_status', ticket: t, status_key: 'review', actor: actor
  echo '{}'
%}`);

  const a = await contextFor(browser, users.agent);
  const b = await contextFor(browser, users.superadmin);
  const list = await contextFor(browser, users.superadmin);
  const bSocket = subscribed(b.page);
  const listSocket = subscribed(list.page);
  await a.page.goto(desk('/support-desk/board'));
  bSocket.reset();
  await b.page.goto(desk('/support-desk/board'));
  listSocket.reset();
  await list.page.goto(desk(`/support-desk?view=all_open&q=${encodeURIComponent(subject)}`));
  await expect(list.page.locator('.pos-support-row', { hasText: subject })).toBeVisible();
  expect(await columnOf(a.page, ticket.id)).toBe('review');
  await expect.poll(() => bSocket.ready() && listSocket.ready(), { timeout: 15000 }).toBe(true);

  await a.page.dragAndDrop(`.pos-support-card[data-ticket-id="${ticket.id}"]`, '.pos-support-column[data-status-key="customer"] [data-cards]');
  await expect.poll(() => columnOf(a.page, ticket.id), { timeout: 20000 }).toBe('customer');
  await expect.poll(() => ticketBySubject(subject).ticket.status_id, { timeout: 20000 }).not.toBe(ticket.status_id);
  await expect.poll(() => columnOf(b.page, ticket.id), { timeout: 45000 }).toBe('customer');
  // the list shows All open (new and open); a ticket waiting on the customer leaves it live
  await expect(list.page.locator('.pos-support-row', { hasText: subject })).toHaveCount(0, { timeout: 45000 });

  // the card has no Move form any more; without JavaScript its assignee button opens the ticket's assignee field
  liquid(`{% liquid
  function t = 'modules/support/queries/tickets/find', id: '${ticket.id}', number: null, member: null
  assign actor = { "type": "system", "id": null, "member": null }
  function r = 'modules/support/commands/tickets/change_status', ticket: t, status_key: 'review', actor: actor
  echo '{}'
%}`);
  const noJs = await contextFor(browser, users.superadmin, { javaScriptEnabled: false });
  await noJs.page.goto(desk(`/support-desk/board?q=${encodeURIComponent(subject)}`));
  const card = noJs.page.locator(`.pos-support-card[data-ticket-id="${ticket.id}"]`);
  await expect(card.locator('form')).toHaveCount(0);
  await card.locator('[data-support-assign]').click();
  await expect(noJs.page).toHaveURL(new RegExp(`/support-desk/tickets/${ticket.id}#pos-support-side-assignee$`));
  await expect(noJs.page.locator('#pos-support-side-assignee')).toBeVisible();
  for (const c of [a, b, list, noJs]) await c.context.close();
});

test('16. a blocked domain creates nothing, and after Mark as spam the next email from that address creates nothing', async ({ browser }) => {
  const admin = await contextFor(browser, users.superadmin);
  const domain = `${unique('blk')}.example`;
  await admin.page.goto(desk('/support-desk/settings/blocklist'));
  await admin.page.fill('#bl-pattern', domain);
  await admin.page.fill('#bl-reason', 'E2E');
  await admin.page.click('form:has(#bl-pattern) button[type=submit]');
  await expect(admin.page.locator('table')).toContainText(domain);

  const blockedSubject = unique('E2E blocked domain');
  const blockedId = await inbound({ from: `someone@mail.${domain}`, to: 'e2e@support-dev.platformos.com', subject: blockedSubject, body: 'spam' });
  await new Promise((r) => setTimeout(r, 20000));
  expect(ticketBySubject(blockedSubject).count).toBe(0);
  const stored = liquid(`{% liquid
  graphql r = 'modules/support/inbound_emails/search', limit: 50
  assign ids = r.records.results | map: 'message_id_header'
  assign out = { "found": false }
  if ids contains '${blockedId.replace(/[<>]/g, '')}'
    assign out.found = true
  endif
  echo out | json | html_safe
%}`);
  expect(stored.found).toBe(false);

  const spammer = `${unique('spammer')}@e2e.example`;
  const subject = unique('E2E spam');
  await inbound({ from: spammer, to: 'e2e@support-dev.platformos.com', subject, body: 'Buy now' });
  const ticket = await waitForTicket(subject);
  await admin.page.goto(desk(`/support-desk/tickets/${ticket.id}`));
  await admin.page.click('.pos-support-spam-form button[type=submit]');
  await expect(admin.page.locator('.pos-support-ticket-badges')).toContainText('Spam');
  await admin.page.goto(desk('/support-desk/settings/blocklist'));
  await expect(admin.page.locator('table')).toContainText(spammer);
  await expect(admin.page.locator('table')).not.toContainText(spammer.split('@')[1] + ' domain');

  const nextSubject = unique('E2E spam again');
  await inbound({ from: spammer, to: 'e2e@support-dev.platformos.com', subject: nextSubject, body: 'Buy now again' });
  await new Promise((r) => setTimeout(r, 20000));
  expect(ticketBySubject(nextSubject).count).toBe(0);
  await admin.context.close();
});
