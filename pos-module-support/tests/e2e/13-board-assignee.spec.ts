// Board assignee picker (Project 28: "Assignee picker on cards replaces the
// hover Move form"): the card's assignee button, the unassigned mark, choosing
// without a confirm step, Undo, keyboard, and the agent's limited choices.
import fs from 'fs';
import path from 'path';
import { test, expect, Page } from '@playwright/test';
import { contextFor, desk, liquid, newTicket, ticketField, users } from './helpers';

const state = () => JSON.parse(fs.readFileSync(path.join(__dirname, '.state.json'), 'utf8'));

const unassign = (id: string) => liquid(`{% liquid
  function t = 'modules/support/queries/tickets/find', id: '${id}', number: null, member: null
  assign actor = { "type": "system", "id": null, "member": null }
  function r = 'modules/support/commands/tickets/assign', ticket: t, assignee_id: null, reason: null, actor: actor
  echo '{}'
%}`);

const boardFor = async (page: Page, subject: string) => {
  await page.goto(desk(`/support-desk/board?q=${encodeURIComponent(subject)}`));
  return page.locator('.pos-support-card', { hasText: subject });
};

test('B1. a manager assigns from the card without confirming, and Undo puts it back', async ({ browser }) => {
  const { ticket, subject } = await newTicket('E2E board assign');
  unassign(ticket.id);
  const agentId = state().agent_profile_id;

  const admin = await contextFor(browser, users.superadmin);
  const card = await boardFor(admin.page, subject);
  const button = card.locator('[data-support-assign]');
  // no Move form; the unassigned mark with its accessible name
  await expect(card.locator('form')).toHaveCount(0);
  await expect(button.locator('.pos-support-unassigned')).toBeVisible();
  await expect(button).toHaveAttribute('aria-label', /Unassigned/);

  await button.click();
  const pop = admin.page.locator('.pos-support-assign-pop');
  await expect(pop).toBeVisible();
  await expect(pop.locator('[role="option"][data-me]')).toBeVisible();
  // Unassign is not offered on an unassigned ticket
  await expect(pop.locator('[role="option"][data-unassign]')).toHaveCount(0);
  await pop.locator(`[role="option"][data-value="${agentId}"]`).click();
  await expect(pop).toHaveCount(0);

  await expect.poll(() => ticketField(ticket.id, 'assignee_id'), { timeout: 20000 }).toBe(agentId);
  await expect(card.locator('[data-support-assign]')).toHaveAttribute('data-assignee-id', agentId, { timeout: 20000 });
  await expect(card.locator('[data-support-assign]')).toHaveAttribute('aria-label', /Assigned to/);

  await admin.page.locator('.pos-support-toast-undo').click();
  await expect.poll(() => ticketField(ticket.id, 'assignee_id') || null, { timeout: 20000 }).toBeNull();
  await expect(card.locator('[data-support-assign] .pos-support-unassigned')).toBeVisible({ timeout: 20000 });
  await admin.context.close();
});

test('B2. the picker works from the keyboard and Escape returns focus to the button', async ({ browser }) => {
  const { ticket, subject } = await newTicket('E2E board assign keys');
  const agentId = state().agent_profile_id;
  const admin = await contextFor(browser, users.superadmin);
  const card = await boardFor(admin.page, subject);
  const button = card.locator('[data-support-assign]');

  await button.focus();
  await admin.page.keyboard.press('Enter');
  const pop = admin.page.locator('.pos-support-assign-pop');
  await expect(pop).toBeVisible();
  // the current assignee is marked
  await expect(pop.locator(`[role="option"][data-value="${ticket.assignee_id}"]`)).toHaveAttribute('aria-selected', 'true');
  await admin.page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(button).toBeFocused();

  // Unassign is last; End is not available with a search box, so go down to it
  await admin.page.keyboard.press('Enter');
  const options = pop.locator('[role="option"]:not([hidden])');
  const count = await options.count();
  for (let i = 0; i < count; i++) await admin.page.keyboard.press('ArrowDown');
  await expect(pop.locator('[role="option"][data-unassign]')).toHaveClass(/pos-support-richselect-active/);
  await admin.page.keyboard.press('Enter');
  await expect.poll(() => ticketField(ticket.id, 'assignee_id') || null, { timeout: 20000 }).toBeNull();
  await expect(card.locator('[data-support-assign]')).toBeFocused({ timeout: 20000 });
  expect(agentId).toBeTruthy();
  await admin.context.close();
});

test('B3. an agent can only take a ticket or give up their own', async ({ browser }) => {
  const { ticket, subject } = await newTicket('E2E board assign agent');
  unassign(ticket.id);
  const agentId = state().agent_profile_id;
  const agent = await contextFor(browser, users.agent);
  const card = await boardFor(agent.page, subject);

  await card.locator('[data-support-assign]').click();
  const pop = agent.page.locator('.pos-support-assign-pop');
  await expect(pop.locator('[role="option"]')).toHaveCount(1);
  await pop.locator('[role="option"][data-me]').click();
  await expect.poll(() => ticketField(ticket.id, 'assignee_id'), { timeout: 20000 }).toBe(agentId);

  await expect(card.locator('[data-support-assign]')).toHaveAttribute('data-assignee-id', agentId, { timeout: 20000 });
  await card.locator('[data-support-assign]').click();
  await expect(pop.locator('[role="option"]')).toHaveCount(1);
  await expect(pop.locator('[role="option"][data-unassign]')).toContainText('Unassign me');
  await agent.page.keyboard.press('Escape');
  await agent.context.close();
});
