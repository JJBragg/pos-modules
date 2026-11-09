# 10 — Testing and Definition of Done

## 1. Test layers

| Layer | Where | Run with | Covers |
|---|---|---|---|
| Static | all files | `validate_code` before each write; `check-run` (platformos-cli MCP) or `pos-cli check run -f json` per task; `npm run test:static` → `tests/ci-static.sh` | Liquid/GraphQL/YAML validity, frontmatter, missing partials, unknown filters; every admin page has `metadata.permission` + permission include; module references stay within the allowed set |
| Unit (Liquid) | `app/lib/test/**/<name>_test.liquid` using `modules/tests/assertions/*` | `unit-tests-run` MCP / `pos-cli test run staging` / `/_tests` | commands, helpers, algorithms |
| Fixtures | `tests/fixtures/email/*.json` (SendGrid payloads captured in TASK-1) | posted by unit tests to the commands, and by E2E to the webhook | parsing, threading, loop rules |
| E2E | `tests/*.spec.ts` + `tests/pages/` page objects (Playwright, like pos-module-user) | `npm run pw-tests` locally against `support-dev`; pos-modules CI on every push | queue, ticket, profile, settings, PWA manifest, notifications |
| Live mail | staging + real mail clients | manual script `tests/manual/mail-clients.md` | Gmail, Outlook web, Outlook desktop, Apple Mail iOS/macOS threading |

Assert on specific values or check codes, never only on "valid". A test must fail when the behaviour it covers is removed.

## 2. Required unit tests (minimum)

- Threading: token match; tampered token rejected; header match via `In-Reply-To`; via `References` only; Message-ID shared by > 3 tickets ignored; subject token accepted for requester and rejected for stranger; closed ticket → follow-up; merged ticket pointer followed.
- Loop rules: `Auto-Submitted: auto-replied` gets no acknowledgement; 21st email in an hour ignored as loop; duplicate Message-ID ignored.
- Quote stripping: Gmail, Outlook, Apple Mail, our delimiter, Polish/German/Hungarian "wrote" lines.
- Contacts/orgs: free-mail domain creates no organization; second email of a contact matches.
- Ticket numbers: two creates in a row give consecutive numbers.
- Confirmation: auto_close closes at the end of the waiting period; keep_open notifies once and never closes; changing the mode applies to tickets already waiting.
- Status categories: customer reply in pending → In progress; in solved → In progress; in closed → follow-up; moving to New refused.
- SLA: business-hours addition across a weekend and a holiday; pause in pending shifts resolution; first reply met is not reset by reopen; due_soon threshold at 25 %.
- Assignment: picks fewest open; tie → least recently assigned; skips Away/Off/out-of-hours/at-cap; none available → escalation jobs scheduled; host alter hook overrides.
- Notifications: defaults all on; switching push off for `assigned` stops push only; pause skips both; dedupe within 2 min; customer emails unaffected.
- Outbound headers: Message-ID stored before send; In-Reply-To = newest customer message; References order and cap; `[#number]` appended once.
- Permissions: agent cannot read another department's ticket by id; agent cannot merge; POST without CSRF refused.
- Access (D-24): host `admin` without membership → 403 no-access page with Request access; superadmin → membership created once with `source: superadmin`; role map on → created with the mapped role; disabled member → 403 on the next request and not recreated by superadmin/role map; last active admin cannot be disabled; anonymous → `/support-desk/sign-in`, never `/sessions/new`.
- Invites (D-25): new email → user created with `roles: []` (assert the profile has no roles even when `USER_DEFAULT_ROLE` is set); existing email → membership added, no second user; token wrong / expired / reused → same generic page; staff candidates come from roles granting `admin_pages.view` (test with a host whose admin role is `superadmin` and one where it is `admin`).
- Blocklist (D-27): blocked address and blocked domain (incl. subdomain) → 200 to the provider and no `inbound_email`/`message` rows; hits incremented; Mark as spam blocks the address, never the domain; unblock lets the next email in.
- Secret rotation (D-28): old secret accepted for 24 h after rotation, refused after; provider update failure keeps both valid.
- Board (D-26): within a column P0 before P1, and two P1s newest first; move to a status the rules refuse returns an error and the ticket is unchanged.
- Branding: override > hook > default for each key; manifest JSON has scope `/support-desk/`.

## 3. Required E2E scenarios (MVP acceptance — detailed PRD "MVP acceptance criteria")

1. Webhook fixture → ticket appears in queue within 60 s, assigned to the least-loaded agent, activity log names the reason.
2. Reply from the ticket → SendGrid request body asserted via a stub endpoint on staging (`setting.sendgrid_base_url` overridable in test) → message `sent`.
3. Customer reply fixture with our token → lands on the same ticket, `needs_reply` set, queue row updates live.
4. Internal note never appears in the outbound email body.
5. Two browser contexts on one ticket → presence shown; second sender warned.
6. Waiting on customer pauses SLA; customer reply resumes it.
7. Auto-close mode: Confirmation + sweep with a waiting period of 0 → Closed; later reply → follow-up ticket. Keep-open mode: same setup → ticket stays in Confirmation and the assignee gets exactly one `confirm_wait` push and email.
8. Profile: switch off push for "assigned"; assign → no push request, email request made.
9. Manifest and service worker served with correct content types and scope; Lighthouse PWA installability passes for `/support-desk`.
10. Host app switch: example app with a dark host theme → module pages use host variables (computed style check on `.pos-button`).
11. Fresh instance install with generator → all of the above pass without editing host files beyond what the generator wrote.
12. **Marketing-site host** (example app with no members and no admin area): install → first admin signs in at `/support-desk/sign-in` → invites an external agent → agent sets a password from the email link and works tickets; the agent's profile has no roles.
13. **Community-style host** (admin role `superadmin`, admin layout that bounces non-admins): Support appears in the host admin menu and redirects into the desk; Pick existing staff lists the superadmins; an invited external agent reaches `/support-desk` and is refused by the host's `/admin`.
14. Host admin without membership → Request access → support admin approves with role and departments → the requester gets access and a notification.
15. Board: drag a card from Under review to Waiting on customer → status changes, list and other browsers update live; with JavaScript off the card's assignee button opens the ticket's assignee field. Board assignee picker: 13-board-assignee (B1–B3).
16. Blocklist: block a domain in Settings → a fixture email from that domain creates nothing; Mark as spam on a ticket → the next email from that address creates nothing.

## 4. Definition of Done (copy into `backlog/config.yml`)

1. Acceptance criteria of the task met and checked.
2. Every changed Liquid/GraphQL/YAML file passed `validate_code` before it was written; `check-run` reports zero errors for the module.
3. Tests written and passing (unit for logic, E2E for user-visible behaviour); each test fails when its behaviour is removed.
4. Deployed to our instance (`support-dev`) with `deploy-start` (never `pos-cli deploy`) and smoke-checked by loading the URL and reading `logs-fetch`; pushed to `feature/pos-module-support` and pos-modules CI green.
5. Security invariants hold: permission check on every page, department scope on every query, CSRF on every POST, ownership load before every by-id write, no secrets or bodies in logs.
6. Translations: every user-visible string in `translations/en.yml`; no "translation missing" on the page.
7. Accessibility: keyboard reachable, visible focus, 4.5:1 contrast with the example host theme and the default theme, status never by colour alone.
8. Docs: README / CLAUDE.md / SKILL.md updated when behaviour, hooks, settings or constants change.
9. Task file Final Summary written as `Done / Outcome / Next`.
