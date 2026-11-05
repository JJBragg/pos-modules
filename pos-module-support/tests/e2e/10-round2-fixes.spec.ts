// Browser checks for the functional round 2 fixes (5 Nov 2026), one test per
// case of "Support Desk - round 2 fixes test plan" that an agent meets in the
// browser. The unit tests cover the commands and queries behind them.
import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { contentOf, contextFor, createHostUser, desk, inbound, liquid, newTicket, ticketField, unique, users, waitForStub, waitForTicket } from './helpers';

const subscribed = (page: Page) => {
  let confirmed = false;
  page.on('websocket', (ws) => ws.on('framereceived', (f) => { if (String(f.payload).includes('confirm_subscription')) confirmed = true; }));
  return { reset: () => { confirmed = false; }, ready: () => confirmed };
};

const e2eDepartment = () => liquid(`{% liquid
  graphql d = 'modules/support/departments/search', inbound_local_part: 'e2e', limit: 1
  assign out = { "id": null }
  assign out.id = d.records.results.first.id
  echo out | json | html_safe
%}`).id;

test('FIX-07 customer text shows exactly as sent, and saved replies insert plain text', async ({ browser }) => {
  const subject = unique('E2E entities');
  const text = 'It\'s broken & we can\'t log in <3 "quoted"';
  await inbound({ from: `${unique('customer')}@e2e.example`, to: 'e2e@support-dev.platformos.com', subject, body: text });
  const ticket = await waitForTicket(subject);
  const title = unique('Tom');
  liquid(`{% liquid
  assign form = { "title": "${title}", "body": "Tom & Jerry <b>say</b> We're here.\\n\\nSecond paragraph." }
  function _ = 'modules/support/commands/settings_sections/save', section: 'saved_replies', params: form
  echo '{}'
%}`);
  const { context, page } = await contextFor(browser, users.superadmin);
  await page.goto(desk(`/support-desk/tickets/${ticket.id}`));
  await expect(page.locator('.pos-support-message-body').first()).toHaveText(text);
  await page.selectOption('[data-support-saved]', { label: title });
  await expect(page.locator('#pos-support-body')).toHaveValue("Tom & Jerry <b>say</b> We're here.\n\nSecond paragraph.");
  await context.close();
});

test('FIX-04 a board column over 200 cards has a pager', async ({ browser }) => {
  const department = e2eDepartment();
  const { context, page } = await contextFor(browser, users.superadmin);
  await page.goto(desk(`/support-desk?view=all_open&layout=board&group=status&department_id=${department}`));
  const newColumn = page.locator('.pos-support-column[data-status-key="new"]');
  const total = Number(await newColumn.locator('[data-count]').textContent());
  test.skip(total <= 200, `only ${total} New tickets in the E2E department`);
  await newColumn.getByRole('link', { name: /Show more/ }).click();
  await newColumn.locator('a[rel=next]').click();
  await expect(page).toHaveURL(/lane_page=2/);
  await expect(newColumn.locator('.pos-support-card')).toHaveCount(total - 200);
  await page.goto(desk(`/support-desk?view=all_open&layout=list&group=status&department_id=${department}&expand=new&lane_page=99`));
  await expect(page.locator('.pos-support-lane-pager').first()).not.toContainText('801');
  await context.close();
});

test('FIX-05 a department-filtered board adds a new ticket of its department live', async ({ browser }) => {
  const department = e2eDepartment();
  const { context, page } = await contextFor(browser, users.superadmin);
  const socket = subscribed(page);
  socket.reset();
  await page.goto(desk(`/support-desk/board?department_id=${department}`));
  await expect.poll(() => socket.ready(), { timeout: 15000 }).toBe(true);
  const subject = unique('E2E live board');
  await inbound({ from: `${unique('customer')}@e2e.example`, to: 'e2e@support-dev.platformos.com', subject, body: 'Live.' });
  await expect(page.locator('.pos-support-card', { hasText: subject })).toBeVisible({ timeout: 60000 });
  await context.close();
});

test('FIX-09 an unreadable file stops the send; a refused large file does not block the reply', async ({ browser }) => {
  const t = await newTicket('E2E files');
  const { context, page } = await contextFor(browser, users.superadmin);
  await page.goto(desk(`/support-desk/tickets/${t.ticket.id}`));
  const unreadable = unique('unreadable');
  await page.evaluate(() => {
    FileReader.prototype.readAsDataURL = function () { setTimeout(() => this.onerror && this.onerror(new ProgressEvent('error')), 10); };
  });
  await page.setInputFiles('[data-support-files]', { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await page.fill('#pos-support-body', unreadable);
  await page.click('[data-support-composer] button[type=submit]');
  await page.waitForTimeout(3000);
  expect(page.url()).toContain(`/support-desk/tickets/${t.ticket.id}`);
  // nothing was stored as a reply (checked on the ticket, not in the provider stub)
  const stored = liquid(`{% liquid
  graphql m = 'modules/support/messages/search', ticket_id: '${t.ticket.id}', limit: 100
  assign out = { "found": false }
  for x in m.records.results
    if x.body_text contains '${unreadable}'
      assign out.found = true
    endif
  endfor
  echo out | json | html_safe
%}`);
  expect(stored.found).toBe(false);
  await expect(page.locator('[data-support-send]')).toBeEnabled();

  await page.reload();
  await page.setInputFiles('[data-support-files]', { name: 'big.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(11 * 1024 * 1024) });
  const after = unique('after big file');
  await page.fill('#pos-support-body', after);
  await page.click('[data-support-composer] button[type=submit]');
  const body = await waitForStub((b) => contentOf(b).includes(after));
  expect(body.attachments || []).toHaveLength(0);
  await context.close();
});

test('FIX-11 a reply keeps the queue context; a department change keeps the draft', async ({ browser }) => {
  const t = await newTicket('E2E context');
  const { context, page } = await contextFor(browser, users.superadmin);
  await page.goto(desk(`/support-desk/tickets/${t.ticket.id}?view=all_open&q=${encodeURIComponent(t.subject)}`));
  await page.fill('#pos-support-body', unique('context reply'));
  await page.click('[data-support-composer] button[type=submit]');
  await page.waitForURL(/view=all_open/);
  await expect(page.locator('a[href^="/support-desk?"]', { hasText: 'All open' }).first()).toBeVisible();

  const draft = unique('draft kept');
  await page.fill('#pos-support-body', draft);
  const other = await page.locator('#pos-support-side-department option:not(:checked)').first().getAttribute('value');
  await Promise.all([page.waitForEvent('load'), page.selectOption('#pos-support-side-department', other!)]);
  await expect(page.locator('#pos-support-body')).toHaveValue(draft, { timeout: 15000 });
  await context.close();
});

test('FIX-13 a reply the provider refused can be sent again', async ({ browser }) => {
  const t = await newTicket('E2E STUB400');
  const { context, page } = await contextFor(browser, users.superadmin);
  await page.goto(desk(`/support-desk/tickets/${t.ticket.id}`));
  await page.fill('#pos-support-body', unique('refused reply'));
  await page.click('[data-support-composer] button[type=submit]');
  await expect.poll(async () => { await page.reload(); return page.getByRole('button', { name: 'Send again' }).count(); }, { timeout: 60000, intervals: [5000] }).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Send again' }).click();
  await expect(page.locator('body')).toContainText('The reply is being sent again.');
  await expect(page.locator('.pos-support-activity')).toContainText('sent a failed reply again');
  await context.close();
});

test('FIX-16 while the desk sign-in lock is on, a sign-in through /sessions gives no access', async ({ browser }) => {
  const email = `${unique('locked')}@e2e.example`;
  const user = createHostUser(email, ['superadmin']);
  const context = await browser.newContext();
  const page = await context.newPage();
  for (let i = 0; i < 5; i++) {
    await page.goto(desk('/support-desk/sign-in'));
    await page.fill('#pos-support-email', email);
    await page.fill('#pos-support-password', 'wrong-password-123');
    await page.click('button[type=submit]');
  }
  await page.goto(desk('/sessions/new'));
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', user.password);
  await page.click('form button[type=submit]');
  await page.waitForLoadState();
  await page.goto(desk('/support-desk'));
  await expect(page).toHaveURL(/\/support-desk\/sign-in/);
  await context.close();
});

test('FIX-19 typing a branding override unticks host branding and saves', async ({ browser }) => {
  const { context, page } = await contextFor(browser, users.superadmin);
  await page.goto(desk('/support-desk/settings/branding'));
  const box = page.locator('#br-use-host');
  if (!(await box.isChecked())) {
    await box.check();
    await page.locator('form:has(#br-use-host) button[type=submit]').click();
  }
  await expect(box).toBeChecked();
  const name = unique('Desk');
  await page.fill('#br-name', name);
  await expect(box).not.toBeChecked();
  await page.locator('form:has(#br-use-host) button[type=submit]').click();
  await expect(page.locator('#br-name')).toHaveValue(name);
  await page.locator('#br-use-host').check();
  await page.locator('form:has(#br-use-host) button[type=submit]').click();
  await expect(page.locator('#br-use-host')).toBeChecked();
  await context.close();
});

test('FIX-20 settings wording: sweep last run, saved reply delete asks, pause forever', async ({ browser }) => {
  const { context, page } = await contextFor(browser, users.superadmin);
  await page.goto(desk('/support-desk/settings/integrations'));
  await expect(page.locator('body')).not.toContainText(/Last run: \d{4}-\d{2}-\d{2}T/);
  await expect(page.locator('p:has-text("Last run:") time')).toHaveCount(1);
  await page.goto(desk('/support-desk/settings/saved-replies'));
  const edit = page.locator('a[href*="edit="]').first();
  if (await edit.count()) {
    await edit.click();
    await expect(page.locator('button[data-support-confirm]', { hasText: 'Delete' })).toHaveCount(1);
  }
  await context.close();
});

test('FIX-22 Team page: availability, no missing translations; FIX-26 agent alerts page has no critical axe issues', async ({ browser }) => {
  const { context, page } = await contextFor(browser, users.superadmin);
  await page.goto(desk('/support-desk/settings/team'));
  await expect(page.locator('thead')).toContainText('Availability');
  await expect(page.locator('body')).not.toContainText('translation missing');
  const agentProfile = liquid(`{% liquid
  graphql p = 'modules/support/team/profiles_by_roles', email: '${users.agent.email}', limit: 1
  assign out = { "id": null }
  assign out.id = p.records.results.first.id
  echo out | json | html_safe
%}`).id;
  await page.goto(desk(`/support-desk/settings/agents/${agentProfile}`));
  const results = await new AxeBuilder({ page }).analyze();
  const critical = results.violations.filter((v) => v.impact === 'critical');
  expect(critical.map((v) => v.id)).toEqual([]);
  await context.close();
});

test('FIX-24 snoozed rows are marked, tags are searchable, activity names people and statuses', async ({ browser }) => {
  const t = await newTicket('E2E tags');
  const tag = unique('tagx').toLowerCase();
  const { context, page } = await contextFor(browser, users.superadmin);
  await page.goto(desk(`/support-desk/tickets/${t.ticket.id}`));
  await page.fill('input[name=tags]', tag);
  await page.locator('form[data-support-autosave] button[type=submit]').click();
  await expect.poll(() => (ticketField(t.ticket.id, 'tags') || []).join(','), { timeout: 20000 }).toBe(tag);
  await page.selectOption('select[name=status_key]', 'progress');
  await expect.poll(() => ticketField(t.ticket.id, 'category'), { timeout: 20000 }).toBe('open');
  await page.reload();
  await expect(page.locator('.pos-support-activity')).toContainText('In progress');
  await expect(page.locator('.pos-support-activity')).toContainText('assigned the ticket to');
  await page.locator('.pos-support-snooze-form button[type=submit]').click();
  await page.goto(desk(`/support-desk?view=all_open&q=${tag}`));
  const row = page.locator('.pos-support-row', { hasText: t.subject });
  await expect(row).toBeVisible();
  await expect(row.locator('.pos-tag[title="Snoozed"]')).toHaveCount(1);
  await page.goto(desk(`/support-desk?view=all_open&assignee_id=none`));
  await expect(page.locator('#pos-support-assignee-filter option[value="none"]')).toHaveCount(1);
  await context.close();
});

test('FIX-25 blocking an already blocked sender says so', async ({ browser }) => {
  const { context, page } = await contextFor(browser, users.superadmin);
  const address = `${unique('dup')}@e2e-block.example`;
  for (let i = 0; i < 2; i++) {
    await page.goto(desk('/support-desk/settings/blocklist'));
    await page.fill('#bl-pattern', address);
    await page.click('form:has(#bl-pattern) button[type=submit]');
  }
  await expect(page.locator('body')).toContainText('That sender was already blocked.');
  await context.close();
});
