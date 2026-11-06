// Scenarios 9–10 (tech-spec 10 §3) and the accessibility pass (TASK-25 AC3):
// manifest, service worker and installability; host theme variables reach
// the desk; no serious or critical axe violations on the main pages.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { BASE, contextFor, desk, liquid, users } from './helpers';

test('9. manifest and service worker are served with the right types and scope, and the desk is installable', async ({ browser, request }) => {
  const manifest = await request.get(desk('/support-desk/manifest.json'));
  expect(manifest.status()).toBe(200);
  expect(manifest.headers()['content-type']).toMatch(/json/);
  const json = await manifest.json();
  expect(json.scope).toMatch(/^\/support-desk\/?$/);
  expect(json.start_url).toMatch(/^\/support-desk/);
  expect(json.display).toBe('standalone');
  expect(json.icons.map((i: any) => i.sizes)).toContain('512x512');

  const sw = await request.get(desk('/support-desk/sw.js'));
  expect(sw.status()).toBe(200);
  expect(sw.headers()['content-type']).toMatch(/javascript/);
  expect(sw.headers()['service-worker-allowed']).toBe('/support-desk');

  const { context, page } = await contextFor(browser, users.agent);
  await page.goto(desk('/support-desk'));
  await expect.poll(() => page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration('/support-desk');
    return reg ? reg.scope : null;
  }), { timeout: 30000 }).toContain('/support-desk');
  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);
  await context.close();
});

test('10. the host theme variables reach the desk', async ({ browser }) => {
  const { context, page } = await contextFor(browser, users.agent);
  await page.goto(desk('/support-desk'));
  const colors = await page.evaluate(() => ({
    button: getComputedStyle(document.querySelector('.pos-button-primary, .pos-support-toolbar .pos-button') as Element).backgroundColor,
    rail: getComputedStyle(document.querySelector('.pos-support-rail') as Element).backgroundColor,
    token: getComputedStyle(document.documentElement).getPropertyValue('--pos-color-button-primary-background').trim(),
  }));
  expect(colors.token.toLowerCase()).toBe('#1d4f91');
  expect(colors.rail).toBe('rgb(243, 245, 248)');
  await context.close();
});

const pages = (ticketId: string) => [
  '/support-desk',
  '/support-desk/board',
  `/support-desk/tickets/${ticketId}`,
  '/support-desk/profile',
  '/support-desk/settings/departments',
  '/support-desk/settings/team',
  '/support-desk/settings/blocklist',
  '/support-desk/settings/email',
  '/support-desk/settings/branding',
];

for (const scheme of ['light', 'dark'] as const) {
  test(`accessibility: no serious or critical axe violations (${scheme})`, async ({ browser }) => {
    const ticket = liquid(`{% liquid
  graphql r = 'modules/support/tickets/search', limit: 1
  assign out = { "id": null }
  assign out.id = r.records.results.first.id
  echo out | json | html_safe
%}`);
    const { context, page } = await contextFor(browser, users.superadmin, { colorScheme: scheme });
    const problems: string[] = [];
    for (const path of [...pages(ticket.id), '/support-desk/sign-in']) {
      if (path.endsWith('/sign-in')) {
        await context.clearCookies();
      }
      await page.goto(`${BASE}${path}`);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      for (const v of results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')) {
        problems.push(`${path}: ${v.id} (${v.impact}) × ${v.nodes.length}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
    await context.close();
  });
}
