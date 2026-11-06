# Support Desk module

A white-label support desk for platformOS apps. Customers email you; every email becomes or joins a ticket; your team works the queue at `/support-desk` and replies from the ticket. The desk takes the host app's colours, fonts, name and logo, installs as its own app (PWA) with push notifications, and works on any app: one with members and an admin area, or a marketing site with no users at all.

> **Status: in development** on the `feature/pos-module-support` branch. Not yet released to the marketplace.

## What it does (MVP)

- Email to ticket through the email provider you choose at install (SendGrid in the first release), with threading by reply token, headers and subject.
- Agent queue as a list (swim lanes) or a board (columns), grouped by priority or status; the layout and grouping stay as agents switch views; departments with live counts in the side navigation. Ticket page with replies and internal notes, saved replies, collision warnings and live updates.
- Departments, statuses over six fixed categories, priorities P0–P3 with SLA targets and business hours.
- Least-loaded auto-assignment with an escalation safety net.
- Push and email alerts for agents, each switchable per person.
- Team managed inside the module: pick existing staff or invite people by email; invited outsiders get Support only.
- Blocklist and Mark as spam, webhook secret rotation, audit log.

## Requirements

- Modules: `core`, `user`, `common-styling`, `push_notifications` (installed with this module).
- An email provider account. The MVP ships the SendGrid adapter: an API key with Mail Send, Sender Authentication, Inbound Parse and Event Webhook (Mail Settings) access, and a hostname for inbound mail whose MX record you can set.
- On staging instances, enable **API call notifications** for the instance in the Partner Portal, or outgoing API calls (SendGrid) are not sent.

## Installation

1. Install the module and deploy the app once, so the module's tables, pages and seed migration (statuses, a default department "Support", SLA policy, settings, ticket counter) are on the instance:

   ```bash
   pos-cli modules install support
   pos-cli deploy <env>
   ```

2. Run the install generator and answer its questions:

   ```bash
   pos-cli generate run modules/support/generators/install
   ```

   Every step checks what exists first, so you can run it again at any time (for another environment, or after fixing something); a second run changes nothing. It never edits the host's permissions file and never writes a password or secret to a file. It:

   - keeps or removes the Support entry in host admin menus (`admin/support`);
   - names the **first support admin**: an existing user gets an admin membership; a new user is created with no host roles and the password you type, sent straight to the environment; the email is also stored in `modules/support/ADMIN_EMAILS` for recovery;
   - reports whether anonymous visitors can register (`users.register` on `anonymous`) — marketing sites usually turn that off;
   - optionally gives host roles that can see the admin area (`admin_pages.view`) a support role (`role_map` setting);
   - creates `app/lib/hooks/hook_headscripts.liquid` (your layout's stylesheets, so the desk uses your theme) and `app/lib/hooks/hook_support_branding.liquid` (name, logo, colours) if they do not exist;
   - sets the email provider, its API key (`EMAIL_API_KEY`) and the inbound hostname, and generates `INBOUND_SECRET`, `EVENTS_SECRET` and `REPLY_TOKEN_SECRET`;
   - tells you to run the push module's generator if the push keys are missing;
   - prints the DNS record and the (masked) inbound webhook URL.

3. Deploy again (`pos-cli deploy <env>`) if the generator wrote hook files, sign in at `/support-desk/sign-in` as the first admin, and finish **Settings → Email** (next section).

4. Add your team in **Settings → Team** (pick existing users or invite by email), departments in **Settings → Departments**, and adjust **SLA and hours** (business hours default to Mon–Fri 09:00–17:00).

## Email setup (SendGrid)

Settings → Email walks through these steps; each unlocks the next and its result is stored in the `email_status` setting:

1. **API key** — paste or rotate the key; "Check" calls SendGrid with it.
2. **Sending domain** — authenticate the domain you send from in SendGrid (Sender Authentication); the page shows the DNS records SendGrid gives you and checks them.
3. **Inbound** — add the MX record `10 mx.sendgrid.net` for your inbound hostname; "Create" registers the Inbound Parse host with the webhook URL `https://<your-app>/api/support/inbound/sendgrid/<INBOUND_SECRET>` (raw MIME on). The URL is masked; Reveal shows it.
4. **Test** — sends a test email; "Check inbound" waits for one to arrive.
5. **Delivery events** — creates the module's own Event Webhook (`/api/support/email-events/sendgrid/<EVENTS_SECRET>`) so bounces show on the ticket. An account's other Event Webhooks are left alone.
6. **Enable** — turns on sending. Until then nothing is emailed to customers.

"Rotate secret" generates a new inbound secret, updates SendGrid and accepts the previous secret for 24 hours, so no mail is lost. Choose the EU API region on the same page if your SendGrid account is in the EU.

Outgoing mail: every customer email gets its own `Message-ID` (stored before sending) and a signed reply address (`<department>+t.<number>.<mac>@<inbound host>`) in `Reply-To`. Attachments are capped at 10 MB per email.

## Access

The desk is a standalone section at `/support-desk` with its own sign-in at `/support-desk/sign-in`. Access comes only from the module's team membership records (`team_member`), never from the host's roles or permissions file:

- A host user with the `superadmin` role gets an admin membership on their first visit.
- An email listed in `modules/support/ADMIN_EMAILS` (comma-separated) gets an admin membership on first visit; use it to recover access.
- Holders of a host role listed in the `role_map` setting get that support role on first visit (off by default).
- Invited people accept at `/support-desk/invites/:id`; anyone else signed in sees "You don't have access to Support" and can request access, which support admins approve in Settings → Team.
- A disabled membership is never recreated.

Sign-in lock: 5 failed desk sign-ins for an email within 15 minutes lock it for the rest of that window. The module implements pos-module-user's `user_login` hook, so a sign-in through any other password form of the instance (such as the host's `/sessions`) while the lock is on is marked, and the desk signs that session out on its next desk page. Failed attempts on those other forms (and 2FA codes on `/sessions/2fa`) are not counted by the desk: rate-limit the host's own sign-in form, or remove it if desk users only sign in at `/support-desk/sign-in`.

Support roles: `agent` (own departments, reply), `manager` (all departments, reassign, merge, reports), `admin` (also Team and Settings). The optional page `admin/support` (permission `admin_pages.view`, `metadata.menu.title: Support`) adds Support to host admin menus built from page metadata and only redirects to `/support-desk`.

## Constants

| Constant | Purpose |
|---|---|
| `modules/support/ADMIN_EMAILS` | comma-separated emails that get an admin membership on first visit (recovery) |
| `modules/support/EMAIL_API_KEY` | the email provider's API key |
| `modules/support/INBOUND_SECRET` | secret path segment of the inbound webhook URL |
| `modules/support/EVENTS_SECRET` | secret path segment of the delivery-events webhook URL |
| `modules/support/REPLY_TOKEN_SECRET` | signs the reply token in `Reply-To` addresses; set once at install, never change it on a live desk (old replies would stop threading) |

The generator sets all of them; `pos-cli constants set <env> --name modules/support/<NAME> --value <value>` changes one by hand.

## Settings

Stored in the module's `setting` table and edited under `/support-desk/settings/*` (support admins only): departments (name, short code, inbound local part, From address, signature, SLA policy), statuses (labels over the fixed categories `new`, `open`, `pending`, `on_hold`, `solved`, `closed`; confirmation mode `auto_close`/`keep_open` and 1–28 days), SLA policies and business hours (time zone, days, holidays), saved replies (variables `{{ requester.first_name }}`, `{{ requester.name }}`, `{{ ticket.number }}`, `{{ ticket.subject }}`, `{{ agent.first_name }}`, `{{ brand.name }}`), assignment (unassigned alert minutes, P0 alert, escalate after, spam threshold), team, blocklist, email, branding and integrations (maintenance sweep status and restart). Keys used in code: `email_provider`, `email_region`, `inbound_domain`, `email_status`, `role_map`, `staff_roles`, `free_mail_domains`, `confirmation_mode`, `confirmation_wait_days`, `unassigned_alert_minutes`, `unassigned_alert_minutes_p0`, `escalate_after_minutes`, `spam_threshold`, `branding_override`, `business_hours`, `sweep_heartbeat`, `sweep_started_at`, `ticket_stats_counted_at` (time of the last full count of the stored ticket counts).

## Hooks

| Hook | Return | Used for |
|---|---|---|
| `support_branding` | object: `app_name`, `short_name`, `logo_url`, `logo_dark_url`, `icon_url`, `favicon_url`, `theme_color`, `background_color`, `theme_mode` (`auto`/`light`/`dark`), `rail_theme` (`auto`/`light`/`dark`: pins which logo the sidebar shows; `auto` by default, which picks it from the sidebar's actual colour), `support_email_name` | brand in the desk, emails, manifest and push. Every key is optional; without `app_name` the desk is named after the instance domain (the first label of a `*.platform-os.com` host, e.g. `support-development` → "Support Development", or the custom domain without `www.`). `icon_url` (a square 512 px PNG) replaces the module's icons in the PWA manifest and the iOS home-screen icon |
| `support_assignment` (alter) | sets `params_to_modify.assignee_id` and `.reason` from `params.ticket`, and must `return params_to_modify` | host rule that decides who gets a new ticket before least-loaded assignment |
| `headscripts` (core) | HTML string | host stylesheet, loaded after the module CSS so host tokens win |

The module implements `user_login` (pos-module-user) to mark a sign-in on another form while the desk sign-in lock is on for that email; the desk signs such a session out.

The desk has its own compact type scale, control sizes and layout, built from the host's common-styling tokens: the brand colour (`--pos-color-button-primary-*`) drives primary buttons, focus, selection and the monogram; the rail is a quiet neutral by default. Headings use the body font (`--pos-support-font-heading`), not common-styling's monospace heading font. The desk loads only the common-styling stylesheets it uses (no Markdown editor, highlight.js or Uppy) and sets softer dark neutrals than pure black; a host stylesheet that sets `--pos-color-dark-*` still wins.

CSS tokens a host can override: `--pos-support-font`, `--pos-support-font-heading`, `--pos-support-rail-width`, `--pos-support-rail-background`, `--pos-support-rail-text`, `--pos-support-rail-active-background`, `--pos-support-rail-active-text`, `--pos-support-rail-hover-background`, `--pos-support-rail-frame`, `--pos-support-monogram-background`, `--pos-support-monogram-text`, `--pos-support-radius-{control,card,panel}`, `--pos-support-control-height`, plus every common-styling `--pos-*` token. For a brand-coloured rail set `--pos-support-rail-background` to the brand colour and `--pos-support-rail-text` to white, and give `support_branding` a `logo_dark_url` that reads on it. When the host gives both logos, the desk measures the sidebar's background in the browser and shows the logo made for it, so a dark brand-coloured sidebar gets the dark-background logo in both colour schemes; nothing else to set. `rail_theme` pins the choice if needed. Without JavaScript the logo follows `theme_mode` and then the device setting.

Status, priority, SLA, internal-note, avatar and presence colours are fixed semantic tokens with light and dark values checked for 4.5:1 contrast: `--pos-support-status-{new,open,pending,onhold-eng,onhold,solved,closed}-{fg,bg}`, `--pos-support-priority-p{0..3}-{fg,bg}`, `--pos-support-sla-{overdue,soon,ok,paused}`, `--pos-support-note-{bg,border,fg}`, `--pos-support-avatar-{0..7}` (+ `-fg`), `--pos-support-presence-{available,away,off}`. Hosts can override them, but then they own the contrast. Icons are Lucide (ISC licence) in one SVG sprite (`partials/icons/sprite`). Settings → Branding shows where the brand comes from (host stylesheet, `support_branding` hook, overrides), a preview, and overrides for name, sender name, theme and background colours, both logos, the sidebar logo choice, app icon and favicon. Appearance has its own control: **Follow the host app** (the default) uses the hook's `theme_mode`; the other choices override it.

## Events

Published with `modules/core/commands/events/publish`; consume them in `app/lib/consumers/<event>/<name>.liquid`. Payloads carry ids only.

| Event | Payload |
|---|---|
| `support_ticket_created` | `ticket_id`, `actor_id`, `auto_reply` (the ticket was opened by an auto-reply or bounce: no new-ticket alert, no auto-assignment) |
| `support_ticket_updated` | `ticket_id`, `actor_id` |
| `support_ticket_status_changed` | `ticket_id`, `actor_id`, `from_value`, `to_value` (status keys) |
| `support_ticket_priority_changed` | `ticket_id`, `actor_id`, `to_value` |
| `support_ticket_assigned` | `ticket_id`, `actor_id`, `assignee_id` |
| `support_ticket_unassigned` | `ticket_id`, `stage` |
| `support_ticket_merged` / `support_ticket_unmerged` | `ticket_id`, `actor_id`, `target_id` |
| `support_ticket_linked` | `ticket_id`, `actor_id`, `link_id` |
| `support_message_received` | `ticket_id`, `message_id` |
| `support_message_moved` | `ticket_id`, `message_id`, `from_ticket_id` |
| `support_reply_created` | `ticket_id`, `message_id`, `actor_id` |
| `support_note_created` | `ticket_id`, `message_id`, `actor_id`, `mentioned_ids` |
| `support_sla_due_soon` / `support_sla_breached` | `ticket_id`, `deadline` |
| `support_confirmation_waiting` | `ticket_id` |

## Routes

Desk: `/support-desk` (queue; `view`, `department_id`, `priority`, `status_key`, `assignee_id`, `q`, `sort`, and `layout=list|board` and `group=priority|status`, which are remembered in the session), `/support-desk/board` (the board of a view), `/support-desk/tickets/:id`, `/support-desk/contacts/:id`, `/support-desk/organizations/:id`, `/support-desk/profile`, `/support-desk/settings/*`, `/support-desk/sign-in`, `/support-desk/request-access`, `/support-desk/invites/:id`. PWA: `/support-desk/manifest.json`, `/support-desk/sw.js` (scope `/support-desk`). Webhooks: `/api/support/inbound/:provider/:secret`, `/api/support/email-events/:provider/:secret`.

## Troubleshooting

- **Customer emails do not arrive as tickets.** Check the MX record for the inbound hostname, then Settings → Email → Check inbound. Look for `support` entries in `pos-cli logs <env>`. A sender on the blocklist is refused before anything is stored (Settings → Blocklist shows hits). An email with more than about 11 MB of attachments never reaches the desk: platformOS refuses requests over about 16 MB before any page runs, and the provider gives up after its retries without telling the sender. The acknowledgement tells customers to keep attachments under 10 MB and share larger files through a link.
- **Nothing is sent.** Sending is off until Settings → Email → Enable. On staging, enable API call notifications in the Partner Portal. A 4xx answer from the provider is permanent and shown on the message (with Send again); 408/429 are retried up to five times and 5xx three times.
- **Replies start new tickets.** The reply address carries a token signed with `REPLY_TOKEN_SECRET`; changing that constant breaks threading for older emails. Replies without the token are matched by `In-Reply-To`/`References`, then by subject and sender.
- **SLA timers or alerts stopped.** Settings → Integrations shows the maintenance sweep's last run; "Restart" starts it again. The sweep also restarts by itself when a desk page is opened and it has not run for 15 minutes.
- **Locked out.** Add your email to `modules/support/ADMIN_EMAILS` and sign in again.
- **No push notifications.** The push module's constants must be set (`pos-cli generate run modules/push_notifications/generators/install`); each person enables push on their profile page.

## Development

- The example host app in `app/` (not distributed) is a marketing site at `/` and a community-style admin area at `/admin` (host roles `superadmin` and `editor`, both with `admin_pages.view`), with a demo theme and branding hooks.
- Tests: `pos-cli test run <env>` runs `app/lib/test/support/*_test.liquid` (needs the `tests` module); `npm run test:static` runs the static checks; `pos-cli check run` must report no offenses (CI fails on warnings).
- Seed an environment: `./tests/data/seed/seed.sh <env> [--keep-data]`.
- Tasks and decisions: `backlog/`; the technical specification: `docs/spec/`; progress board: https://github.com/orgs/Platform-OS/projects/28.
