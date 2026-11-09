// Part B of tests/e2e/TEST-PLAN.md: wider end-to-end cases.
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { BASE, choose, contentOf, contextFor, desk, inbound, liquid, newTicket, recipients, reply, stubBodies, ticketBySubject, ticketField, unique, users, waitForStub, waitForTicket } from './helpers';

const state = () => JSON.parse(fs.readFileSync(path.join(__dirname, '.state.json'), 'utf8'));
const settle = (ms = 20000) => new Promise((r) => setTimeout(r, ms));
const messages = (ticketId: string) => liquid(`{% liquid
  graphql r = 'modules/support/messages/search', ticket_id: '${ticketId}', limit: 50
  assign out = { "list": null }
  assign out.list = r.records.results
  echo out | json | html_safe
%}`).list as any[];

test.describe('access and security', () => {
  test('B1. anonymous visitors are sent to the desk sign-in', async ({ page }) => {
    for (const p of ['/support-desk', '/support-desk/board', '/support-desk/settings/team', '/support-desk/profile']) {
      await page.goto(desk(p));
      expect(new URL(page.url()).pathname, p).toBe('/support-desk/sign-in');
    }
  });

  test('B2–B3. an agent gets 403 on Settings and 404 on a ticket outside their departments', async ({ browser }) => {
    const { context, page } = await contextFor(browser, users.agent);
    for (const p of ['departments', 'statuses', 'sla', 'saved-replies', 'assignment', 'team', 'blocklist', 'email', 'branding', 'integrations']) {
      const response = await page.goto(desk(`/support-desk/settings/${p}`));
      expect(response!.status(), p).toBe(403);
    }
    const { ticket } = await newTicket('E2E other department', 'accela@support-dev.platformos.com');
    const response = await page.goto(desk(`/support-desk/tickets/${ticket.id}`));
    expect(response!.status()).toBe(404);
    await expect(page.locator('body')).not.toContainText(ticket.subject);
    await context.close();
  });

  test('B4. POSTs without a valid token change nothing', async ({ browser }) => {
    const { ticket } = await newTicket('E2E csrf');
    const { context, page } = await contextFor(browser, users.superadmin);
    const before = ticketField(ticket.id, 'priority');
    const target = before === 'p0' ? 'p3' : 'p0';
    const posts: [string, Record<string, string>][] = [
      [`/support-desk/tickets/${ticket.id}/update`, { change: 'properties', priority: target, status_key: 'progress' }],
      [`/support-desk/tickets/${ticket.id}/messages`, { mode: 'note', body: 'csrf note' }],
      ['/support-desk/tickets/bulk', { 'ids[]': ticket.id, bulk_priority: target }],
      ['/support-desk/board/move', { ticket_id: ticket.id, status_key: 'hold', respond: 'json' }],
      ['/support-desk/settings/save', { section: 'assignment', unassigned_alert_minutes: '99', unassigned_alert_minutes_p0: '5', escalate_after_minutes: '30', spam_threshold: '5' }],
      ['/support-desk/settings/blocklist', { pattern: 'csrf-test.example' }],
    ];
    for (const [url, form] of posts) {
      const response = await page.request.post(desk(url), { form: { authenticity_token: 'bad', ...form }, maxRedirects: 0 });
      expect(response.status(), url).not.toBe(200);
    }
    expect(ticketField(ticket.id, 'priority')).toBe(before);
    expect(messages(ticket.id).some((m) => String(m.body_text || '').includes('csrf note'))).toBe(false);
    await context.close();
  });

  test('B5. webhooks with a wrong secret are not accepted', async () => {
    const form = new FormData();
    form.set('email', 'From: a@b.example\r\nSubject: x\r\n\r\nx');
    const inboundResponse = await fetch(`${BASE}/api/support/inbound/sendgrid/wrong-secret`, { method: 'POST', body: form });
    expect(inboundResponse.status).not.toBe(200);
    const events = await fetch(`${BASE}/api/support/email-events/sendgrid/wrong-secret`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[]' });
    expect(events.status).not.toBe(200);
  });

  test('B6. customer HTML with a script is shown only in the sandboxed frame and the script does not run', async ({ browser }) => {
    const subject = unique('E2E html');
    await inbound({ from: `${unique('customer')}@e2e.example`, to: 'e2e@support-dev.platformos.com', subject, html: true, body: `<p>Hello <b>desk</b></p><script>parent.document.title='HACKED';top.document.title='HACKED'</script><img src=x onerror="top.document.title='HACKED'">` });
    const ticket = await waitForTicket(subject);
    const { context, page } = await contextFor(browser, users.superadmin);
    await page.goto(desk(`/support-desk/tickets/${ticket.id}`));
    const frame = page.locator('iframe.pos-support-html-frame').first();
    await expect(frame).toHaveCount(1);
    expect(await frame.getAttribute('sandbox')).not.toContain('allow-scripts');
    await page.locator('details.pos-support-original summary').first().click();
    await page.waitForTimeout(2000);
    expect(await page.title()).not.toBe('HACKED');
    await context.close();
  });

  test('B7–B8. no missing translations on desk pages; a wrong password is refused with a message', async ({ browser, page }) => {
    const { ticket } = await newTicket('E2E translations');
    const pages = ['/support-desk', '/support-desk?view=needs_reply', '/support-desk/board?show_closed=1', `/support-desk/tickets/${ticket.id}`, `/support-desk/contacts/${ticket.requester_id}`, '/support-desk/profile'];
    const settings = ['departments', 'statuses', 'sla', 'saved-replies', 'assignment', 'team', 'blocklist', 'email', 'branding', 'integrations'].map((p) => `/support-desk/settings/${p}`);
    for (const [user, list] of [[users.superadmin, [...pages, ...settings]], [users.agent, pages]] as const) {
      const { context, page: p } = await contextFor(browser, user);
      for (const url of list) {
        await p.goto(desk(url));
        await expect(p.locator('body'), `${user.email} ${url}`).not.toContainText('translation missing');
      }
      await context.close();
    }
    await page.goto(desk('/support-desk/sign-in'));
    await page.fill('#pos-support-email', users.agent.email);
    await page.fill('#pos-support-password', 'definitely-wrong-password');
    await page.click('button[type=submit]');
    await expect(page.locator('body')).toContainText('The email or password is not correct.');
    expect(new URL(page.url()).pathname).toBe('/support-desk/sign-in');
  });
});

test.describe('queue and ticket', () => {
  test('B9–B11. search by number, status filter, bulk priority and keyboard open', async ({ browser }) => {
    const one = await newTicket('E2E bulk one');
    const two = await newTicket('E2E bulk two');
    const { context, page } = await contextFor(browser, users.superadmin);
    await page.goto(desk(`/support-desk?view=all_open&q=%23${one.ticket.number}`));
    await expect(page.locator('.pos-support-row')).toHaveCount(1);
    await expect(page.locator('.pos-support-row')).toContainText(one.subject);

    await page.goto(desk('/support-desk?view=all_open&status_key=new&q=E2E+bulk'));
    for (const row of await page.locator('.pos-support-row').all()) await expect(row).toContainText('New');

    await page.goto(desk('/support-desk?view=all_open&q=E2E+bulk'));
    for (const t of [one.ticket, two.ticket]) await page.locator(`.pos-support-row input[value="${t.id}"]`).check();
    await choose(page, '#pos-support-bulk-priority', 'p1');
    await page.click('.pos-support-bulk-bar button[type=submit]:not([name])');
    // the change runs in the background: the page answers at once, a toast follows
    await expect(page.locator('body')).toContainText('Updating the selected tickets');
    await expect(page.locator('body')).toContainText('2 tickets updated.', { timeout: 60000 });
    expect(ticketField(one.ticket.id, 'priority')).toBe('p1');
    expect(ticketField(two.ticket.id, 'priority')).toBe('p1');

    await page.goto(desk(`/support-desk?view=all_open&q=%23${two.ticket.number}`));
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('j');
    await Promise.all([page.waitForURL(/\/support-desk\/tickets\//), page.keyboard.press('Enter')]);
    expect(page.url()).toContain(`/support-desk/tickets/${two.ticket.id}`);
    await context.close();
  });

  test('B12, B15–B17. priority and tags, snooze, merge and undo, GitHub link', async ({ browser }) => {
    const a = await newTicket('E2E props');
    const b = await newTicket('E2E merge target');
    const { context, page } = await contextFor(browser, users.superadmin);
    await page.goto(desk(`/support-desk/tickets/${a.ticket.id}`));
    // properties save as soon as a choice changes, without reloading (the badge
    // is swapped in place); tags need Save
    await page.check('input[name=priority][value=p0]');
    await expect(page.locator('.pos-support-ticket-title .pos-support-priority')).toHaveText('P0');
    await page.fill('#pos-support-side-tags', 'billing, E2E');
    await page.click('form:has(#pos-support-side-tags) button[type=submit]');
    await expect(page.locator('.pos-toast').last()).toContainText('Ticket updated.');
    await page.reload();
    await expect(page.locator('.pos-support-activity')).toContainText('changed priority');
    expect(ticketField(a.ticket.id, 'priority')).toBe('p0');
    expect(ticketField(a.ticket.id, 'tags')).toEqual(['billing', 'e2e']);

    await page.fill('#pos-support-issue-url', 'https://github.com/Platform-OS/pos-modules/issues/1');
    await page.click('form:has(#pos-support-issue-url) button[type=submit]');
    await expect(page.locator('a[href="https://github.com/Platform-OS/pos-modules/issues/1"]')).toBeVisible();

    await page.fill('#pos-support-merge-target', `#${b.ticket.number}`);
    await page.click('form:has(#pos-support-merge-target) button[type=submit]');
    await expect(page).toHaveURL(new RegExp(`/support-desk/tickets/${b.ticket.id}`));
    expect(messages(b.ticket.id).some((m) => m.moved_from_ticket_id === a.ticket.id)).toBe(true);
    await page.goto(desk(`/support-desk/tickets/${a.ticket.id}`));
    await page.click('form:has(input[name=change][value=unmerge]) button');
    await expect.poll(() => messages(b.ticket.id).some((m) => m.moved_from_ticket_id === a.ticket.id), { timeout: 30000 }).toBe(false);

    await page.goto(desk(`/support-desk/tickets/${a.ticket.id}`));
    const snooze = page.locator('select[name=snooze_until]');
    await expect(snooze, 'the ticket page offers Snooze').toHaveCount(1);
    await choose(page, snooze, { index: 0 });
    await page.click('.pos-support-snooze-form button[type=submit]');
    await expect(page.locator('.pos-support-snooze-form')).toContainText('Snoozed until');
    await expect(page.locator('.pos-support-activity')).toContainText('snoozed the ticket');
    expect(ticketField(a.ticket.id, 'snooze_until')).toBeTruthy();
    await page.click('.pos-support-snooze-form button[type=submit]');
    await expect(page.locator('select[name=snooze_until]')).toHaveCount(1);
    await context.close();
  });

  test('B13–B14, B22, B31. reply with CC, attachment, saved reply and department signature; delimiter in outgoing mail', async ({ browser }) => {
    const { ticket, customer } = await newTicket('E2E composer');
    const { context, page } = await contextFor(browser, users.superadmin);
    const replyName = unique('E2E saved');
    await page.goto(desk('/support-desk/settings/saved-replies'));
    await page.fill('#sr-title', replyName);
    await page.fill('#sr-body', 'Hello {{ requester.first_name }}, about ticket #{{ ticket.number }}.');
    await page.click('form:has(#sr-title) button[type=submit]');
    await expect(page.locator('.pos-support-plain-list')).toContainText(replyName);

    const signature = unique('E2E signature');
    await page.goto(desk(`/support-desk/settings/departments?edit=${state().department_id}`));
    await page.fill('#dep-signature', signature);
    await page.click('form:has(#dep-signature) button[type=submit]');

    await page.goto(desk(`/support-desk/tickets/${ticket.id}`));
    await choose(page, '[data-support-saved]', { label: replyName });
    await expect(page.locator('#pos-support-body')).toHaveValue(new RegExp(`ticket #${ticket.number}`));
    const marker = unique('composer');
    await page.locator('#pos-support-body').press('End');
    await page.locator('#pos-support-body').pressSequentially(` ${marker}`);
    const cc = `${unique('cc')}@e2e.example`;
    await page.fill('#pos-support-cc', cc);
    await page.setInputFiles('#pos-support-files', { name: 'permit.txt', mimeType: 'text/plain', buffer: Buffer.from('permit 123') });
    await page.waitForTimeout(500);
    await page.click('[data-support-composer] button[type=submit]');
    const body = await waitForStub((b) => contentOf(b).includes(marker));
    expect(recipients(body)).toContain(customer);
    const ccs = (body.personalizations || []).flatMap((p: any) => (p.cc || []).map((c: any) => c.email));
    expect(ccs).toContain(cc);
    expect(body.attachments?.[0]?.filename).toBe('permit.txt');
    expect(Buffer.from(body.attachments[0].content, 'base64').toString()).toBe('permit 123');
    expect(contentOf(body)).toContain(signature);
    expect(contentOf(body), 'reply delimiter (04 §2.5)').toMatch(/##-[^\n]*above this line[^\n]*-##/i);
    await context.close();
  });
});

test.describe('inbound and delivery', () => {
  test('B18–B20. acknowledgement for a new customer, none for an auto-reply, one message per Message-ID', async () => {
    const { ticket, customer } = await newTicket('E2E acknowledgement');
    await waitForStub((b) => recipients(b).includes(customer) && contentOf(b).includes(String(ticket.number)), 90000);

    const robot = `${unique('robot')}@e2e.example`;
    const subject = unique('E2E auto reply');
    await inbound({ from: robot, to: 'e2e@support-dev.platformos.com', subject, body: 'I am out of office.', headers: ['Auto-Submitted: auto-replied'] });
    await waitForTicket(subject);
    await settle();
    expect(stubBodies().some((b) => recipients(b).includes(robot))).toBe(false);

    const dupSubject = unique('E2E duplicate');
    const id = `<${unique('dup')}@e2e.example>`;
    const from = `${unique('customer')}@e2e.example`;
    await inbound({ from, to: 'e2e@support-dev.platformos.com', subject: dupSubject, body: 'once', messageId: id });
    const dup = await waitForTicket(dupSubject);
    await inbound({ from, to: 'e2e@support-dev.platformos.com', subject: dupSubject, body: 'once', messageId: id });
    await settle();
    expect(messages(dup.id).filter((m) => m.author_type === 'customer').length).toBe(1);
    expect(ticketBySubject(dupSubject).count).toBe(1);
  });

  test('B21. a provider bounce marks the reply bounced and warns in the composer', async ({ browser }) => {
    const { ticket, customer } = await newTicket('E2E bounce');
    const { context, page } = await contextFor(browser, users.agent);
    const marker = unique('bounce-me');
    await reply(page, ticket.id, `Answer ${marker}`);
    const sent = messages(ticket.id).find((m) => String(m.body_text || m.body_html || '').includes(marker));
    expect(sent).toBeTruthy();
    const secret = liquid(`{% liquid
  assign out = { "s": null }
  assign out.s = context.constants['modules/support/EVENTS_SECRET']
  echo out | json | html_safe
%}`).s;
    const events = [{ event: 'bounce', type: 'bounce', email: customer, reason: '550 mailbox unavailable', support_message_id: sent.id, timestamp: Math.floor(Date.now() / 1000) }];
    const response = await fetch(`${BASE}/api/support/email-events/sendgrid/${secret}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(events) });
    expect(response.status).toBe(200);
    await expect.poll(() => messages(ticket.id).find((m) => m.id === sent.id).delivery_state, { timeout: 60000, intervals: [3000] }).toBe('bounced');
    await page.goto(desk(`/support-desk/tickets/${ticket.id}`));
    await expect(page.locator('[data-support-composer]')).toContainText(/bounce/i);
    await context.close();
  });
});

test.describe('settings, contacts, profile', () => {
  test('B23. assignment numbers out of range are refused', async ({ browser }) => {
    const { context, page } = await contextFor(browser, users.superadmin);
    await page.goto(desk('/support-desk/settings/assignment'));
    const field = page.locator('[name=unassigned_alert_minutes]');
    const before = await field.inputValue();
    await field.evaluate((el: HTMLInputElement) => { el.removeAttribute('min'); el.removeAttribute('max'); el.value = '0'; });
    await page.click('form:has([name=unassigned_alert_minutes]) button[type=submit]');
    await expect(page.locator('body')).toContainText('Enter a whole number of minutes from 1 to 10080.');
    await page.goto(desk('/support-desk/settings/assignment'));
    await expect(page.locator('[name=unassigned_alert_minutes]')).toHaveValue(before);
    await context.close();
  });

  test('B24. a branding override shows in the desk and the manifest, and can be reset', async ({ browser, request }) => {
    const { context, page } = await contextFor(browser, users.superadmin);
    const name = unique('E2E Brand');
    try {
      await page.goto(desk('/support-desk/settings/branding'));
      await page.uncheck('[name=use_host]');
      await page.fill('#br-name', name);
      await page.fill('#br-short', name);
      await page.click('form:has(#br-name) button[type=submit]');
      await page.goto(desk('/support-desk'));
      await expect(page.locator('.pos-support-rail .pos-support-brand')).toContainText(name);
      const manifest = await (await request.get(desk('/support-desk/manifest.json'))).json();
      expect(manifest.name).toContain(name);
    } finally {
      await page.goto(desk('/support-desk/settings/branding'));
      await page.fill('#br-name', '');
      await page.fill('#br-short', '');
      await page.check('[name=use_host]');
      await page.click('form:has(#br-name) button[type=submit]');
      await page.goto(desk('/support-desk'));
      await expect(page.locator('.pos-support-rail .pos-support-brand')).not.toContainText(name);
      await context.close();
    }
  });

  test('B26. contact page: edit the name, add an address, and mail from it joins the contact', async ({ browser }) => {
    const { ticket } = await newTicket('E2E contact');
    const { context, page } = await contextFor(browser, users.superadmin);
    await page.goto(desk(`/support-desk/contacts/${ticket.requester_id}`));
    const name = unique('E2E Person');
    await page.fill('#ct-name', name);
    await page.click('form:has(#ct-name) button[type=submit]');
    await expect(page.locator('h1')).toContainText(name);
    const second = `${unique('second')}@e2e.example`;
    await page.locator('form:has(input[name=change][value=add_email]) input[type=email]').fill(second);
    await page.click('form:has(input[name=change][value=add_email]) button[type=submit]');
    await expect(page.locator('body')).toContainText(second);
    const subject = unique('E2E second address');
    await inbound({ from: second, to: 'e2e@support-dev.platformos.com', subject, body: 'from my other address' });
    const t2 = await waitForTicket(subject);
    expect(t2.requester_id).toBe(ticket.requester_id);
    await context.close();
  });

  test('B27. availability and pause on the profile page', async ({ browser }) => {
    const { context, page } = await contextFor(browser, users.agent);
    const member = () => liquid(`{% liquid
  function u = 'modules/user/queries/user/find', email: '${users.agent.email}', id: null, with_token: false, expires_in: null
  function p = 'modules/user/queries/profiles/find', user_id: u.id, id: null, uuid: null, first_name: null, last_name: null
  function m = 'modules/support/queries/team_members/find', profile_id: p.id
  echo m | json | html_safe
%}`);
    try {
      await page.goto(desk('/support-desk/profile'));
      await page.click('form:has(input[name=change][value=availability]):has(input[name=value][value=away]) button');
      await expect.poll(() => member().availability, { timeout: 20000 }).toBe('away');
      await page.goto(desk('/support-desk/profile'));
      await page.click('form:has(input[name=change][value=pause]):has(input[name=option][value=hour]) button');
      await expect.poll(() => member().paused_until, { timeout: 20000 }).toBeTruthy();
      await page.goto(desk('/support-desk/profile'));
      await page.click('form:has(input[name=change][value=resume]) button');
      await expect.poll(() => member().paused_until || null, { timeout: 20000 }).toBeNull();
    } finally {
      await page.goto(desk('/support-desk/profile'));
      await page.click('form:has(input[name=change][value=availability]):has(input[name=value][value=available]) button');
      await expect.poll(() => member().availability, { timeout: 20000 }).toBe('available');
      await context.close();
    }
  });
});

test.describe('live and mobile', () => {
  test('B29. a new ticket appears on the first queue page without a reload', async ({ browser }) => {
    const { context, page } = await contextFor(browser, users.superadmin);
    let ready = false;
    page.on('websocket', (ws) => ws.on('framereceived', (f) => { if (String(f.payload).includes('confirm_subscription')) ready = true; }));
    await page.goto(desk('/support-desk?view=all_open'));
    await expect.poll(() => ready, { timeout: 15000 }).toBe(true);
    const subject = unique('E2E live new');
    await inbound({ from: `${unique('customer')}@e2e.example`, to: 'e2e@support-dev.platformos.com', subject, body: 'live' });
    await expect(page.locator('.pos-support-row', { hasText: subject })).toBeVisible({ timeout: 60000 });
    await context.close();
  });

  test('B30. queue, ticket, board and settings fit a 390 px phone screen', async ({ browser }) => {
    const { ticket } = await newTicket('E2E mobile');
    const { context, page } = await contextFor(browser, users.superadmin, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const problems: string[] = [];
    for (const p of ['/support-desk', `/support-desk/tickets/${ticket.id}`, '/support-desk/board', '/support-desk/settings/team', '/support-desk/profile']) {
      await page.goto(desk(p));
      const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
      if (scroll > width + 1) problems.push(`${p}: page is ${scroll}px wide on a ${width}px screen`);
    }
    await page.goto(desk(`/support-desk/tickets/${ticket.id}`));
    const box = await page.locator('#pos-support-body').boundingBox();
    if (!box || box.width < 250) problems.push('composer narrower than 250px');
    expect(problems, problems.join('\n')).toEqual([]);
    await context.close();
  });
});

