# Support desk — end-to-end test plan

Scope: the MVP of pos-module-support as built on `feature/pos-module-support` (TASK-0 … TASK-31), tested end to end on the staging instance `support-dev` with the example host app (marketing site + community-style `/admin`).

## Environment and data

- Instance: `support-dev` (https://support-development.staging.oregon.platform-os.com), example app deployed from the branch.
- Email: for the whole run every provider call goes to the example app's SendGrid stub (`/test/sendgrid-stub`, set by `global-setup.ts`, reset by `global-teardown.ts`), so nothing reaches real mailboxes; the stub keeps the last 40 request bodies for assertions. Inbound mail is posted to the real webhook (`/api/support/inbound/sendgrid/<secret>`) as SendGrid Inbound Parse does.
- People: support admin (host superadmin), agent "Agnes" (DOB + E2E departments, available), host editor without membership, and throwaway users created per run (`*@e2e.example`).
- Department "E2E" (`e2e@support-dev.platformos.com`), active, created by the setup; customers are `customer-*@e2e.example`.
- Not covered on this instance: a fresh install (scenario 11 needs a new instance), real push delivery to a device, real mail clients (manual matrix in `tests/manual/mail-clients.md`).

Run: `MPKIT_URL=… E2E_ENV=support-dev npx playwright test` from `pos-module-support/`.

## Part A — acceptance scenarios (tech-spec 10 §3)

| ID | Scenario | Spec file |
|---|---|---|
| A1 | Webhook email → ticket in the agent's queue within 60 s, auto-assigned to the least-loaded agent; activity log names the reason | 01-email-flow (1, 1b) |
| A2 | Reply from the ticket → provider request with the customer, subject and token Reply-To; message `sent` | 01-email-flow (2) |
| A3 | Customer reply with the token → same ticket, `needs_reply`, queue row updates live | 01-email-flow (3) |
| A4 | Internal note never in a customer email | 01-email-flow (4) |
| A5 | Two agents on one ticket: presence shown; the other agent is warned when one sends | 02-ticket-work (5) |
| A6 | Waiting on customer pauses the SLA; a customer reply resumes it | 02-ticket-work (6) |
| A7 | Confirmation: auto_close closes, later reply → follow-up ticket; keep_open notifies the assignee once | 02-ticket-work (7) |
| A8 | Push for "assigned" switched off → email sent, no push | 02-ticket-work (8) |
| A9 | Manifest + service worker types and scope; Chrome reports the desk installable | 03-pwa-theme-a11y (9) |
| A10 | Host theme variables reach the desk | 03-pwa-theme-a11y (10) |
| A11 | Fresh install with the generator → first admin signs in, every section loads | 06-fresh-install (skipped without a fresh instance) |
| A12 | Marketing-site host: admin invites an outsider → password from the email link → works tickets; profile has no host roles | 04-access (12) |
| A13 | Community host: Support in the host admin menu → desk; Pick existing staff lists superadmins; outsider refused by host `/admin` | 04-access (13) |
| A14 | Host admin without membership → Request access → approved → access + notification | 04-access (14) |
| A15 | Board drag → status changes, other boards and the list follow live; with JS off the assignee button opens the ticket | 05-board-blocklist (15) |
| A15b | Board assignee picker: assign without confirm + Undo, keyboard and Escape, agent limited to Assign/Unassign me | 13-board-assignee (B1–B3) |
| A16 | Blocked domain creates nothing; after Mark as spam the next email from that address creates nothing | 05-board-blocklist (16) |
| AX | axe: no serious/critical WCAG 2.1 AA violations on the main pages, light and dark | 03-pwa-theme-a11y |

## Part B — wider end-to-end cases

| ID | Area | Steps | Expected | Spec file |
|---|---|---|---|---|
| B1 | Access | Anonymous visitor opens desk pages | Redirect to `/support-desk/sign-in` | 07-plan |
| B2 | Access | Agent opens each Settings page | 403, no settings content | 07-plan |
| B3 | Access | Agent opens a ticket of a department they do not serve | 404, no ticket content | 07-plan |
| B4 | Security | POST to ticket update, messages, bulk, board move, settings save and blocklist without a valid token | Refused (422 or sign-in), nothing changes | 07-plan |
| B5 | Security | Inbound and events webhooks with a wrong secret | Not accepted (no 200), nothing stored | 07-plan |
| B6 | Security | Customer HTML with `<script>` is shown only inside the sandboxed iframe | Script does not run | 07-plan |
| B7 | Translations | Every desk page as admin and as agent | No "translation missing" | 07-plan |
| B8 | Sign-in | Wrong password | Error message, stays on sign-in | 07-plan |
| B9 | Queue | Search by `#number`; status filter; Board link keeps filters | Exactly that ticket; filter applied | 07-plan |
| B10 | Queue | Bulk: select two tickets → priority P1 | Both P1, flash shown | 07-plan |
| B11 | Queue | Keyboard: `j` focuses the first row, `Enter` opens it | Ticket page opens | 07-plan |
| B12 | Ticket | Change priority, add tags | Saved; activity rows written | 07-plan |
| B13 | Ticket | Reply with CC and an attachment | Provider request has the CC and a base64 attachment | 07-plan |
| B14 | Ticket | Saved reply inserted into the composer | Variables replaced (requester name, ticket number) | 07-plan |
| B15 | Ticket | Snooze until tomorrow | Snooze stored; activity "snoozed" | 07-plan |
| B16 | Ticket | Merge into another ticket, then Undo | Messages move and come back | 07-plan |
| B17 | Ticket | Link a GitHub issue URL | Link shown on the ticket | 07-plan |
| B18 | Inbound | First email from a new customer | Acknowledgement email with the ticket number | 07-plan |
| B19 | Inbound | Auto-reply (`Auto-Submitted: auto-replied`) | Message stored, no acknowledgement | 07-plan |
| B20 | Inbound | Same Message-ID posted twice | One message | 07-plan |
| B21 | Delivery | Provider "bounce" event for a sent reply | Message marked bounced; warning in the composer | 07-plan |
| B22 | Settings | Create a saved reply; edit a department signature | Listed; signature used in the next reply | 07-plan |
| B23 | Settings | Assignment numbers out of range | Error, value unchanged | 07-plan |
| B24 | Settings | Branding override: app name | Rail and manifest use it; reset restores the host name | 07-plan |
| B25 | Settings | Rotate inbound secret | Old and new secret both accepted | not automated: rotation calls the provider, which the run replaces with the stub; verified live in TASK-18 |
| B26 | Contacts | Contact page: edit name, add a second email | Saved; a mail from the second address joins this contact | 07-plan |
| B27 | Profile | Availability Away → Available; Pause 1 hour → Resume | State shown and saved | 07-plan |
| B28 | SLA | Deadline passed + SLA check | Ticket shows Overdue, `support_sla_breached` notification email | not automated end to end: the check recomputes deadlines from the ticket's own times, so it needs a real wait; covered by `app/lib/test/support/sla_test.liquid` |
| B29 | Live | New ticket while the agent watches the first queue page | Row appears without reload | 07-plan |
| B30 | Mobile | Queue, ticket, board and settings at 390 × 844 | No horizontal page scroll; composer usable | 07-plan |
| B31 | Email | Outgoing reply contains the "reply above this line" delimiter that inbound quote stripping recognises (04 §2.5) | Delimiter in the text and HTML parts | 07-plan |

## Pass criteria

- Every Part A and Part B case passes, except A11 which needs a fresh instance; the manual mail-client matrix is a separate sign-off.
- A failing case is recorded below and as a draft task in `backlog/drafts/`, fixed, and the case re-run until it passes.

## Results

### Run 1 — 2026-10-28, before fixes (support-dev, commit e23bd17 + suite)

Part A: 14 of 18 tests passed (A15 passed in that run but failed in 1 of 3 runs); Part B: 13 of 17 tests passed. A11 skipped (no fresh instance). Failures, each recorded as a draft task in `backlog/drafts/`:

| Case | Failure | Draft |
|---|---|---|
| A1 (1b) | Activity log says "assigned the ticket" without the reason | DRAFT-1 |
| A5 | No warning in an open composer when a colleague sends a reply | DRAFT-2 |
| AX | Settings → Email: `link-in-text-block` (light, dark) and `color-contrast` on `.pos-support-ok` (dark) | DRAFT-3 |
| B7 | "translation missing: …settings_email.step6.on" (unquoted YAML `on:` key) | DRAFT-4 |
| B12 | Saving the sidebar on a New ticket changes nothing (status compared with a field tickets do not have) | DRAFT-5 |
| B20 | A second delivery of the same Message-ID during the first's processing created a second ticket | DRAFT-6 |
| B30 | Board page 1781 px wide on a 390 px phone (screen-reader labels escaping the scroll area) | DRAFT-7 |
| B15 | No Snooze control on the ticket page | DRAFT-8 |
| A15 | Intermittent (1 in 3): another browser's list not updated within 45 s after a drag | DRAFT-9 |

Test-side problems found and fixed while building the suite (not module defects): the stub kept only one body (slice on a short list); earlier runs' invited agents and approved requesters joined the E2E department and took tickets (setup now disables them); the agent reached `max_open` from earlier runs' tickets (setup raises it); tests read state before background jobs finished (now polled).

### Run 2 — 2026-10-28, after the fixes

All drafts fixed and deployed; 26/26 Liquid unit tests pass. Full suite, two consecutive runs: **35 passed, 1 skipped (A11), 0 failed** (16 and 17.5 min).
