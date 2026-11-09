// Scenarios 12–14 (tech-spec 10 §3): an invited outsider joins and works
// tickets with no host roles; host admin menu entry and the host's own /admin
// refusing desk-only people; Request access approved by a support admin.
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { choose, contentOf, contextFor, createHostUser, desk, inbound, liquid, recipients, signIn, unique, users, waitForStub, waitForTicket } from './helpers';

const state = () => JSON.parse(fs.readFileSync(path.join(__dirname, '.state.json'), 'utf8'));
const linkIn = (body: any, pattern: RegExp) => {
  const match = contentOf(body).replace(/&amp;/g, '&').match(pattern);
  if (!match) throw new Error('no link in the email');
  return match[0];
};
const profileRoles = (email: string) => liquid(`{% liquid
  function u = 'modules/user/queries/user/find', email: '${email}', id: null, with_token: false, expires_in: null
  function p = 'modules/user/queries/profiles/find', user_id: u.id, id: null, uuid: null, first_name: null, last_name: null
  assign out = { "roles": null }
  assign out.roles = p.roles | default: []
  echo out | json | html_safe
%}`).roles;

test.describe.serial('access', () => {
  const outsider = { email: `${unique('agent')}@e2e.example`, password: unique('Passw0rd-long') };

  test('12. the first admin invites an outsider, who sets a password from the email and works tickets with no host roles', async ({ browser }) => {
    const admin = await contextFor(browser, users.superadmin);
    await admin.page.goto(desk('/support-desk/settings/team'));
    await admin.page.fill('#tm-email', outsider.email);
    await choose(admin.page, '#tm-new-role', 'agent');
    await admin.page.locator('form:has(#tm-email) input[name="department_ids[]"]').filter({ has: admin.page.locator(`xpath=self::*[@value="${state().department_id}"]`) }).check();
    await admin.page.click('form:has(#tm-email) button[type=submit]');
    const email = await waitForStub((b) => recipients(b).includes(outsider.email));
    const link = linkIn(email, /https?:\/\/[^\s"'<>]+\/support-desk\/invites\/[^\s"'<>]+/);
    await admin.context.close();

    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(link);
    await page.fill('#inv-name', 'E2E Outsider');
    await page.fill('#inv-password', outsider.password);
    await Promise.all([page.waitForURL(/\/support-desk(\?|$|\/(?!invites))/), page.click('button[type=submit]')]);
    expect(profileRoles(outsider.email)).toEqual([]);

    const subject = unique('E2E outsider ticket');
    await inbound({ from: `${unique('customer')}@e2e.example`, to: 'e2e@support-dev.platformos.com', subject, body: 'Hello outsider.' });
    const ticket = await waitForTicket(subject);
    await page.goto(desk(`/support-desk/tickets/${ticket.id}`));
    await expect(page.locator('h1')).toContainText(subject);
    await context.close();
  });

  test('13. Support is in the host admin menu, Pick existing staff lists superadmins, and an outsider is refused by the host /admin', async ({ browser }) => {
    const admin = await contextFor(browser, users.superadmin);
    await admin.page.goto(desk('/admin'));
    const entry = admin.page.locator('.host-admin-menu a', { hasText: 'Support' });
    await expect(entry).toBeVisible();
    await Promise.all([admin.page.waitForURL(/\/support-desk/), entry.click()]);
    const staff = createHostUser(`${unique('superadmin')}@e2e.example`, ['superadmin']);
    await admin.page.goto(desk('/support-desk/settings/team'));
    await expect(admin.page.locator('#tm-pick option', { hasText: staff.email })).toHaveCount(1);
    await admin.context.close();

    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, outsider);
    await page.goto(desk('/support-desk'));
    await expect(page).toHaveURL(/\/support-desk/);
    const response = await page.goto(desk('/admin'));
    expect(page.url().includes('/admin') && response!.status() === 200 && (await page.locator('.host-admin-menu').count()) > 0).toBe(false);
    await context.close();
  });

  test('14. a host admin without membership requests access; a support admin approves; the requester gets access and a notification', async ({ browser }) => {
    const host = createHostUser(`${unique('editor')}@e2e.example`, ['editor']);
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, host).catch(() => undefined);
    await page.goto(desk('/support-desk'));
    await page.fill('#ra-note', 'E2E: please let me in');
    await page.click('form[action="/support-desk/request-access"] button[type=submit]');

    const admin = await contextFor(browser, users.superadmin);
    await admin.page.goto(desk('/support-desk/settings/team'));
    const form = admin.page.locator('form:has(input[name=request_id])', { hasText: host.email });
    await choose(admin.page, form.locator('select[name=role]'), 'agent');
    await form.locator(`input[name="department_ids[]"][value="${state().department_id}"]`).check();
    await form.locator('button[value=approve]').click();
    await admin.context.close();

    await waitForStub((b) => recipients(b).includes(host.email));
    await page.goto(desk('/support-desk'));
    await expect(page.locator('.pos-support-queue')).toBeVisible();
    await context.close();
  });
});
