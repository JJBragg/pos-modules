// Shared helpers for the E2E suite (tech-spec 10 §3). The suite runs against
// a staging instance with the example app deployed (support-dev by default):
//   MPKIT_URL       base URL of the instance
//   E2E_ENV         pos-cli environment name (default support-dev)
//   E2E_USERS_FILE  lines "email password role" (default ~/.config/support-desk/test_users)
//   E2E_INBOUND_SECRET or ~/.config/support-desk/inbound_secret
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { expect, Page, Browser, BrowserContext, Locator } from '@playwright/test';

// Picks an option the way a person does: every desk select is the desk's own
// dropdown (pos-support-select.js), and the <select> behind it is hidden, so
// Playwright's selectOption would wait for it to become visible.
export async function choose(page: Page, select: string | Locator, option: string | { label: string } | { index: number }) {
  const field = (typeof select === 'string' ? page.locator(select) : select).first();
  const id = await field.getAttribute('id');
  const index = await field.evaluate((s: HTMLSelectElement, o) => Array.from(s.options).findIndex((opt, i) => (
    typeof o === 'string' ? opt.value === o : 'label' in o ? opt.text.trim() === o.label : i === o.index
  )), option);
  expect(index, `option ${JSON.stringify(option)} in #${id}`).toBeGreaterThanOrEqual(0);
  const current = await field.evaluate((s: HTMLSelectElement) => s.selectedIndex);
  if (current === index) return;
  await page.locator(`#${id}-combobox`).click();
  await page.locator(`.pos-support-richselect-pop [role="option"][data-index="${index}"]`).click();
  // an action dropdown (a "Choose…" prompt, like Saved reply) runs and goes back to its prompt
  if (!(await field.evaluate((s) => s.hasAttribute('data-support-placeholder')))) {
    await expect(field).toHaveJSProperty('selectedIndex', index);
  }
}

export const BASE = process.env.MPKIT_URL || 'https://support-development.staging.oregon.platform-os.com';
export const ENV = process.env.E2E_ENV || 'support-dev';
const MODULE_ROOT = path.resolve(__dirname, '../..');
const CONFIG = path.join(os.homedir(), '.config/support-desk');

type User = { email: string; password: string };
export const users: Record<string, User> = Object.fromEntries(
  fs.readFileSync(process.env.E2E_USERS_FILE || path.join(CONFIG, 'test_users'), 'utf8')
    .trim().split('\n').map((line) => line.trim().split(/\s+/))
    .map(([email, password, role]) => [role, { email, password }])
);

const inboundSecret = () => process.env.E2E_INBOUND_SECRET || fs.readFileSync(path.join(CONFIG, 'inbound_secret'), 'utf8').trim();

export const unique = (prefix: string) => `${prefix}-${crypto.randomBytes(4).toString('hex')}`;

// Runs Liquid on the instance and returns the JSON object it prints.
export function liquid(code: string): any {
  const output = execFileSync('pos-cli', ['exec', 'liquid', ENV, code], { cwd: MODULE_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error(`no JSON in liquid output: ${output.slice(0, 300)}`);
  return JSON.parse(output.slice(start, end + 1));
}

export function liquidFile(file: string, replace: Record<string, string> = {}): any {
  let code = fs.readFileSync(path.join(__dirname, 'liquid', file), 'utf8');
  for (const [key, value] of Object.entries(replace)) code = code.split(key).join(value);
  return liquid(code);
}

export function setting(key: string): any {
  return liquid(`{% liquid
  function settings = 'modules/support/helpers/settings'
  assign out = { "value": null }
  assign out.value = settings['${key}']
  echo out | json | html_safe
%}`).value;
}

export function setSetting(key: string, json: string) {
  liquid(`{% liquid
  assign value = '${json}' | parse_json
  function _ = 'modules/support/commands/settings/set', key: '${key}', value: value
  echo '{}'
%}`);
}

// Request bodies the SendGrid stub received during this run.
export function stubBodies(): any[] {
  return setting('test_stub_bodies') || [];
}

export async function waitForStub(match: (body: any) => boolean, timeout = 60000): Promise<any> {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const found = stubBodies().find(match);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('no matching email reached the stub');
}

export const recipients = (body: any): string[] =>
  (body.personalizations || []).flatMap((p: any) => (p.to || []).map((t: any) => String(t.email).toLowerCase()));

export const contentOf = (body: any): string => (body.content || []).map((c: any) => c.value).join('\n');

// Posts a raw email to the inbound webhook as SendGrid Inbound Parse does.
export async function inbound(opts: { from: string; to: string; subject: string; body: string; headers?: string[]; messageId?: string; html?: boolean; secret?: string; expectStatus?: number }) {
  const messageId = opts.messageId || `<${unique('e2e')}@e2e.example>`;
  const raw = [
    `From: E2E Customer <${opts.from}>`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    `Message-ID: ${messageId}`,
    'Date: ' + new Date().toUTCString(),
    'MIME-Version: 1.0',
    `Content-Type: ${opts.html ? 'text/html' : 'text/plain'}; charset=UTF-8`,
    ...(opts.headers || []),
    '',
    opts.body,
  ].join('\r\n');
  const form = new FormData();
  form.set('email', raw);
  form.set('envelope', JSON.stringify({ to: [opts.to], from: opts.from }));
  form.set('spam_score', '0.0');
  form.set('SPF', 'pass');
  const response = await fetch(`${BASE}/api/support/inbound/sendgrid/${opts.secret ?? inboundSecret()}`, { method: 'POST', body: form });
  if (opts.expectStatus === undefined) expect(response.status).toBe(200);
  else expect(response.status).toBe(opts.expectStatus);
  return messageId;
}

export function ticketBySubject(subject: string): any {
  return liquid(`{% liquid
  graphql r = 'modules/support/tickets/search', query: '${subject}', limit: 5
  assign out = { "ticket": null, "count": 0 }
  assign out.ticket = r.records.results.first
  assign out.count = r.records.total_entries
  echo out | json | html_safe
%}`);
}

export async function waitForTicket(subject: string, timeout = 90000): Promise<any> {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const found = ticketBySubject(subject);
    if (found.ticket) return found.ticket;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`no ticket "${subject}"`);
}

export async function signIn(page: Page, user: User) {
  await page.goto(`${BASE}/support-desk/sign-in`);
  await page.fill('#pos-support-email', user.email);
  await page.fill('#pos-support-password', user.password);
  await Promise.all([page.waitForURL((url) => !url.pathname.endsWith('/sign-in')), page.click('button[type=submit]')]);
}

export async function contextFor(browser: Browser, user: User, options = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  // confirm() before destructive actions and the unsaved-reply warning: the tests mean to proceed
  page.on('dialog', (dialog) => dialog.accept());
  await signIn(page, user);
  return { context, page };
}

// Creates a host user with the given host roles and a random password.
export function createHostUser(email: string, roles: string[]): User {
  const password = crypto.randomBytes(12).toString('base64url');
  const created = JSON.parse(execFileSync('pos-cli', ['exec', 'graphql', ENV, '-f', path.join(MODULE_ROOT, 'modules/user/public/graphql/user/create.graphql'), '-p', JSON.stringify({ email, password })], { cwd: MODULE_ROOT, encoding: 'utf8' }));
  const profile = { uuid: crypto.randomUUID(), user_id: created.data.user.id, first_name: 'E2E', last_name: 'Host', name: 'E2E Host', email, roles, c__names: '' };
  execFileSync('pos-cli', ['exec', 'graphql', ENV, '-f', path.join(MODULE_ROOT, 'modules/user/public/graphql/profiles/create.graphql'), '-p', JSON.stringify(profile)], { cwd: MODULE_ROOT, stdio: 'ignore' });
  return { email, password };
}

export const desk = (p: string) => `${BASE}${p}`;

// A new ticket in the E2E department, waited for until it is assigned.
export async function newTicket(label: string, to = 'e2e@support-dev.platformos.com') {
  const customer = `${unique('customer')}@e2e.example`;
  const subject = unique(label);
  await inbound({ from: customer, to, subject, body: `Question about ${label}.` });
  const ticket = await waitForTicket(subject);
  if (to.startsWith('e2e@')) {
    await expect.poll(() => ticketBySubject(subject).ticket.assignee_id, { timeout: 90000, intervals: [3000] }).not.toBeNull();
  }
  return { customer, subject, ticket: ticketBySubject(subject).ticket };
}

// Replies from the ticket page and returns the provider request body.
export async function reply(page: Page, ticketId: string, text: string, thenStatus?: string) {
  await page.goto(desk(`/support-desk/tickets/${ticketId}`));
  await page.fill('#pos-support-body', text);
  if (thenStatus) await choose(page, '#pos-support-then', thenStatus);
  await page.click('[data-support-composer] button[type=submit]');
  return waitForStub((b) => contentOf(b).includes(text));
}

export const ticketField = (id: string, name: string) => liquid(`{% liquid
  function t = 'modules/support/queries/tickets/find', id: '${id}', number: null, member: null
  assign out = { "value": null }
  assign out.value = t['${name}']
  echo out | json | html_safe
%}`).value;
