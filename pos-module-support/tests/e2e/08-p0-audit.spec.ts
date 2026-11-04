// Targeted checks for the five P0 findings of the performance & security audit
// (project 28, "Ready to test", found on support-dev 30 Oct 2026).
//
// The MVP suite exercises these features but not at the scale or with the
// timing the findings describe: the bulk case uses 2 tickets where the finding
// is about 50, and the attachment case uses 10 bytes where the finding is about
// 3 MB. Each test here reproduces the finding's own conditions and prints the
// number it measured, so a run can be compared with the figures on the card.
import { test, expect, Page } from '@playwright/test';
import { contextFor, desk, liquid, liquidFile, newTicket, unique, users } from './helpers';

const messages = (ticketId: string) => liquid(`{% liquid
  graphql r = 'modules/support/messages/search', ticket_id: '${ticketId}', limit: 50
  assign out = { "list": null }
  assign out.list = r.records.results
  echo out | json | html_safe
%}`).list as any[];

// One call for the whole batch: polling 50 tickets one at a time would spend
// longer in pos-cli than the bulk action under test.
const batchPriority = (label: string) => liquid(`{% liquid
  graphql r = 'modules/support/tickets/search', query: '${label}', limit: 100
  assign n = 0
  for t in r.records.results
    if t.priority == 'p1'
      assign n = n | plus: 1
    endif
  endfor
  assign out = { "total": null, "p1": null }
  assign out.total = r.records.total_entries
  assign out.p1 = n
  echo out | json | html_safe
%}`);

const columnOf = (page: Page, id: string) => page.evaluate((id) => document.querySelector(`.pos-support-card[data-ticket-id="${id}"]`)?.closest('.pos-support-column')?.getAttribute('data-status-key') || null, id);

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// Each ticket costs ~0.4 s on the instance, so 50 in one Liquid call exceeds the
// platform's ~20 s gateway limit. Create them in chunks under one shared label.
function bulkTickets(total: number, chunk = 10): { label: string; ids: string[] } {
  const suffix = unique('p0').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const ids: string[] = [];
  let label = '';
  for (let made = 0; made < total; made += chunk) {
    const out = liquidFile('p0_bulk_tickets.liquid', {
      TICKET_COUNT: String(Math.min(chunk, total - made)),
      OFFSET: String(made),
      LABEL_SUFFIX: suffix,
    });
    label = out.label;
    ids.push(...out.ids);
  }
  return { label, ids };
}

test('P0-A. a reply with a 3.5 MB attachment is accepted and not left failed', async ({ browser }) => {
  const t = await newTicket('P0 attach');
  const { context, page } = await contextFor(browser, users.agent);
  await page.goto(desk(`/support-desk/tickets/${t.ticket.id}`));

  // The finding: 3 MB or more fails with a plain 'BadRequest'.
  const big = Buffer.alloc(Math.round(3.5 * 1024 * 1024), 0x61);
  await page.setInputFiles('#pos-support-files', { name: 'large-permit.txt', mimeType: 'text/plain', buffer: big });
  await page.fill('#pos-support-body', 'Attached the large permit file.');
  const started = Date.now();
  await page.click('[data-support-composer] button[type=submit]');

  await expect.poll(() => messages(t.ticket.id).some((m) => String(m.body_text || '').includes('large permit file')), { timeout: 120000, intervals: [3000] }).toBe(true);
  console.log(`P0-A: 3.5 MB reply stored after ${Date.now() - started} ms`);
  await expect(page.locator('body'), 'no raw BadRequest reaches the agent').not.toContainText('BadRequest');

  const mine = messages(t.ticket.id).find((m) => String(m.body_text || '').includes('large permit file'));
  expect(mine?.delivery_state, 'the reply is not left in a failed state').not.toBe('failed');
  expect(mine?.delivery_error ?? null).toBeNull();
  await context.close();
});

test('P0-B. a bulk priority change on 50 tickets answers without a 504 and applies to every ticket', async ({ browser }) => {
  const fixture = bulkTickets(50);
  expect(fixture.ids, 'the fixture created 50 tickets').toHaveLength(50);

  const { context, page } = await contextFor(browser, users.superadmin);
  await page.goto(desk('/support-desk'));
  const token = await page.getAttribute('input[name=authenticity_token]', 'value');
  expect(token, 'the queue page carries a CSRF token').toBeTruthy();

  // The queue shows 25 rows per lane, so 50 cannot be selected in the UI: the
  // finding's own alternative is to post the ids directly.
  const form = new URLSearchParams();
  form.set('authenticity_token', String(token));
  for (const id of fixture.ids) form.append('ids[]', id);
  form.set('bulk_priority', 'p1');

  const t0 = Date.now();
  const response = await page.request.post(desk('/support-desk/tickets/bulk'), {
    data: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    timeout: 120000,
    maxRedirects: 0,
  });
  const elapsed = Date.now() - t0;
  console.log(`P0-B: bulk priority on 50 tickets -> HTTP ${response.status()} in ${elapsed} ms (finding: 504 at 50)`);
  expect(response.status(), 'the gateway did not time the request out').toBeLessThan(500);

  // The finding's second half: the batch was left partly applied.
  await expect.poll(() => batchPriority(fixture.label).p1, { timeout: 180000, intervals: [5000] }).toBe(50);
  console.log(`P0-B: all 50 tickets reached p1`);
  await context.close();
});

test('P0-C. changing a ticket property saves well under the measured 2-7 s', async ({ browser }) => {
  const t = await newTicket('P0 prop');
  const { context, page } = await contextFor(browser, users.superadmin);
  await page.goto(desk(`/support-desk/tickets/${t.ticket.id}`));

  const samples: number[] = [];
  for (const value of ['p0', 'p1', 'p2', 'p0', 'p1']) {
    const t0 = Date.now();
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/support-desk/'), { timeout: 30000 }),
      page.check(`input[name=priority][value=${value}]`),
    ]);
    samples.push(Date.now() - t0);
  }
  console.log(`P0-C: priority save ${samples.join(', ')} ms (median ${median(samples)}; finding: 2000-7000)`);
  expect(median(samples), 'the finding measured a 2-7 s median per change').toBeLessThan(2000);
  await context.close();
});

test('P0-D. a board card moves before the server answers', async ({ browser }) => {
  const fixture = bulkTickets(1);
  const id = fixture.ids[0];
  liquid(`{% liquid
  function t = 'modules/support/queries/tickets/find', id: '${id}', number: null, member: null
  assign actor = { "type": "system", "id": null, "member": null }
  function r = 'modules/support/commands/tickets/change_status', ticket: t, status_key: 'review', actor: actor
  echo '{}'
%}`);

  const { context, page } = await contextFor(browser, users.superadmin);
  await page.goto(desk('/support-desk/board'));
  await expect.poll(() => columnOf(page, id), { timeout: 20000 }).toBe('review');

  // Hold the move request for 4 s. An optimistic board repaints immediately;
  // the finding says the card moves only once the server answers.
  const held = 4000;
  await page.route('**/support-desk/**', async (route) => {
    if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, held));
    await route.continue();
  });

  const t0 = Date.now();
  await page.dragAndDrop(`.pos-support-card[data-ticket-id="${id}"]`, '.pos-support-column[data-status-key="customer"] [data-cards]');
  await expect.poll(() => columnOf(page, id), { timeout: 2500, intervals: [100] }).toBe('customer');
  const moved = Date.now() - t0;
  console.log(`P0-D: card repainted after ${moved} ms while the POST was held ${held} ms`);
  expect(moved, 'the card did not wait for the server').toBeLessThan(held);
  await context.close();
});
