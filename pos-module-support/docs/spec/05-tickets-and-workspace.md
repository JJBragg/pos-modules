# 05 — Tickets, commands and the agent workspace

Requirements: TK-*, WS-*, CO-* in the detailed PRD. The prototype screens Queue, Ticket, Settings → Statuses, Profile are the visual reference; implement them with common-styling components, not the prototype's inline styles.

## 1. Commands (write path)

Each is `lib/commands/<resource>/<action>.liquid` with `build.liquid` and `check.liquid`, called as `modules/support/commands/<resource>/<action>`, returning the object with `valid` and `errors`. Every command that changes a ticket also writes a `ticket_event`, updates `last_activity_at`, and publishes an event. **Every by-id write first loads the ticket through a permission-scoped query and refuses on a miss** (GraphQL checks no ownership).

| Command | Input | Check (refuse when) | Execute | Event |
|---|---|---|---|---|
| `tickets/create` | subject, department_id, requester_id, channel, priority?, first message | subject blank (use "(no subject)"), department missing | next number (counter), status New, category new, priority default p2, `search_text` | `support_ticket_created` |
| `tickets/change_status` | ticket, status_key, actor | unknown status; moving to `new` | copy category; set `solved_at`/`closed_at`; SLA pause/resume (06 §3); clear `needs_reply` on solved | `support_ticket_status_changed` |
| `tickets/assign` | ticket, assignee_id, reason, actor | assignee not an agent of the department; cap reached (manual assignment may exceed with a warning) | set `assignee_id`, `assigned_at`, `assignment_reason`; team_member.last_assigned_at | `support_ticket_assigned` |
| `tickets/set_priority` | ticket, priority | not p0–p3 | set; recompute SLA deadlines (06) | `support_ticket_priority_changed` |
| `tickets/update_fields` | ticket, subject?, department_id?, tags? | | | `support_ticket_updated` |
| `tickets/snooze` | ticket, until | until in the past | `snooze_until` | — |
| `tickets/merge` | source, target | same ticket; different requester org without manager role | move messages (`moved_from_ticket_id`), source → Closed with `merged_into_id`, keep undo for 30 days | `support_ticket_merged` |
| `tickets/unmerge` | source | older than 30 days | reverse | `support_ticket_unmerged` |
| `messages/create_inbound` | ticket, parsed email | — | message + attachments; `needs_reply`, `last_customer_message_at`; category rule from `categories.customer_reply` | `support_message_received` |
| `messages/create_reply` | ticket, body_html, cc_emails, then_status_key, actor | blank body; CSRF invalid (page) | message (public, agent, queued); set `first_replied_at` once; clear `needs_reply`; `last_agent_reply_at` | `support_reply_created` |
| `messages/create_note` | ticket, body_html, actor | blank | message (internal); parse `@mentions` | `support_note_created` |
| `messages/move` | message, target ticket | target closed | update `ticket_id`, `moved_from_ticket_id` | `support_message_moved` |
| `contacts/find_or_create` | email, name | invalid email | by `emails` with `array_overlaps` (lower-cased); create with org from domain unless free-mail | — |
| `organizations/find_or_create` | domain | domain in free-mail list | by `domains` | — |
| `participants/add` / `remove` | ticket, email, role | | | — |
| `escalation_links/create` | ticket, url | not a GitHub issue URL | link; status → Waiting on deploy | `support_ticket_linked` |
| `saved_replies/render` | saved_reply, ticket | | render whitelisted variables only: `requester.first_name`, `requester.name`, `ticket.number`, `ticket.subject`, `agent.first_name`, `brand.name` | — |
| `team_members/update_own` | user, availability?, prefs?, paused_until? | not self and not admin | upsert team_member | `support_agent_availability_changed` |
| `settings/*` | per section | not `support.settings.manage` | | — |
| `blocklist/add` | value, kind, reason, actor | not admin; invalid address/domain; free-mail domain as `kind: domain` needs confirmation; duplicate | `blocked_sender` | — |
| `blocklist/remove` | id, actor | not admin | delete row; clear `contact.blocked` for an address | — |
| `team/invite`, `team/accept_invite`, `team/request_access`, `team/decide_request`, `team/update_member`, `team/disable` | see 09 §1 | see 09 §1 | `team_member`, `team_invite`, `access_request` | `support_team_changed` |

Events are validated by `lib/events/<name>.liquid` and carry ids only (`ticket_id`, `message_id`, `actor_id`), never bodies.


## 2. Queries (read path)

| Query | Returns |
|---|---|
| `tickets/search` | page of tickets for a view: `view` (mine, needs_reply, unassigned, all_open, waiting, awaiting_confirmation), `department_ids` scope, `priority`, `status_key`, `assignee_id`, `organization_id`, `q` (fulltext or `#number`), `group_by`, `sort` (default SLA due ascending) |
| `tickets/board` | same filters as `tickets/search`, grouped by status: per column the first 50 tickets ordered `priority` asc (p0 first), then `created_at` desc, plus the column count (D-26) |
| `tickets/counts` | counts per view, status, department and priority for the rail (one GraphQL call with aliases) |
| `tickets/find` | one ticket, scoped to departments the user may read |
| `messages/for_ticket` | thread, oldest first, with attachments and authors |
| `ticket_events/for_ticket` | activity log |
| `contacts/find_by_email`, `organizations/find_by_domain` | |
| `agents/available_in_department` | Available agents with open counts (06) |
| `team_members/find` | one membership by `profile_id` (the gate's lookup, every request) |
| `team_members/search` | Team page: members with role, state, departments, source, last sign-in |
| `team/staff_candidates` | profiles whose roles are in `setting.staff_roles` and who are not yet members (Pick existing staff, D-25) |
| `blocklist/search`, `blocklist/match` | list; match an address against address and domain rows |
| `statuses/all`, `departments/all`, `settings/get` | read once per request and kept in `context.exports` (settings: `helpers/settings`, cleared by `settings/set`). No version constant: `constant_set` during a request can hide the other constants from it (found in TASK-6) |

Department scope: agents see tickets in their `department_ids`; `support.tickets.manage.all` sees all.

## 3. Pages and partials

Pages are controllers only (read params → command/query → render partial or redirect). Markup lives in `views/partials/support/**`. Partials declare every parameter in a `{% doc %}` block and never run `{% graphql %}`.

| Screen | Page | Main partials |
|---|---|---|
| Queue | `support-desk/index` | `support/shell` (rail + top bar), `support/queue/attention` (needs reply / SLA at risk / waiting on deploy), `support/queue/toolbar`, `support/queue/group`, `support/queue/row`, `support/queue/bulk_bar`, `support/queue/empty` |
| Ticket | `support-desk/tickets/show` | `support/ticket/header`, `support/ticket/thread`, `support/ticket/message`, `support/ticket/system_event`, `support/ticket/composer`, `support/ticket/sidebar/{details,sla,requester,engineering,activity}` |
| Board | `support-desk/board` | `support/shell`, `support/queue/toolbar` (same filters as the list), `support/board/column`, `support/board/card`, `support/board/move_menu` |
| Profile | `support-desk/profile` | `support/profile/availability`, `support/profile/device` (embeds push module `register` + `subscriptions/index`), `support/profile/notifications` |
| Settings | `support-desk/settings/*` | one partial per section; Email (provider, keys, inbound domain, setup instructions, test email, inbound check, secret reveal/rotate) per 04 §0; Team (members, invites, requests) per 09 §1; Blocklist; Branding per 08 |
| Sign-in, invite, no access | `support-desk/sign-in`, `support-desk/invites/:id`, the gate's 403 page | `support/auth/sign_in`, `support/auth/invite_accept`, `support/auth/no_access` (Request access form) — all in the module layout with the host's branding |

UI requirements carried from the prototype and PRD:
- Queue columns: select, priority, number, department tag, subject + preview (+ GitHub chip), requester + org, status, assignee, SLA (text + bar). Group by status or priority; collapsible groups; bulk assign/status/priority. Rows are links; checkboxes are real `<input type="checkbox">` with labels.
- Attention strip counts are links to filtered views.
- **Board (D-26)**: List / Board switch in the toolbar keeps the current filters (department, priority, assignee, view). One column per status in status order with its count; Closed and Spam only with "Show closed". Cards: priority badge, `#number`, subject, department tag, requester, assignee avatar, SLA text. **Inside a column the order is fixed: priority P0→P3, then newest (`created_at` desc) first**; there is no manual ordering. Drag a card to another column → POST `support-desk/board/move` (CSRF) → `tickets/update` with the column's status (same checks as the ticket page: category rules, permissions, the "moving to New refused" rule); on refusal the card returns and a toast explains why. Every card also has a **Move to** menu (a real form), so the board works without JavaScript and by keyboard. Live updates use the same queue room as the list. Columns load at most 50 cards each, with "Show more".
- **Mark as spam** (ticket header, bulk bar): moves to Spam, sets `contact.blocked`, adds a `blocked_sender` `{kind: address, source: spam_mark}`; never blocks a domain. Undo within the toast removes both.
- Ticket composer: Reply / Internal note tabs (note styled with the warning surface), saved replies, attachments, CC chips, "then: <status>" select, send. Internal notes never render inside any customer email.
- Status and priority badges use the module's semantic tokens (08 §4), shape + text, never colour alone (NF-4).
- Keyboard: `j/k`, `x`, `enter`, `a`, `s`, `p`, `r`, `n`, `/` — one module script, ignored while typing in inputs.
- Responsive to 375 px: rail collapses to a top menu; table becomes a horizontally scrollable box; ticket sidebar stacks under the thread.

## 4. Live updates and presence (WS-9, WS-13)

platformOS WebSocket channels (Action Cable), following pos-module-chat (D-13, decision-11). One channel, `support`, with handlers `views/partials/channels/support/subscribed.liquid` and `receive.liquid`. `subscribed` echoes `true` only when the signed-in profile is an active `team_member` allowed to see that room (department scope for queue rooms, the ticket's department for ticket rooms, own id for profile rooms); `receive` re-checks the same on every message, because a subscription is only authorized when it opens. The Action Cable client is vendored in the module like chat's (`assets/js/vendor/actioncable-<version>.esm.js`). Rooms:
- `queue-<department_id>`: consumer `broadcast_queue_update` sends `{ticket_id, kind}` after any ticket event; the queue JS refetches that row (`support-desk/tickets/:id/row` partial endpoint) and recounts.
- `ticket-<ticket_id>`: presence pings `{state: viewing|replying}` sent through `receive`, which attaches the sender's profile id server-side (never trust one from the client) every 20 s from the ticket page; the header shows "<name> is viewing/replying"; a new message event shows "New message — refresh" above the composer and blocks "Send" until acknowledged.
- `profile-<profile_id>`: personal in-app toasts (assigned to you, @mention).

Server-side broadcasts use a module GraphQL mutation wrapping `channel_send_message(channel_name: "support", room_id, payload)`; payloads carry ids only. Consumers that broadcast skip disabled members, as chat's consumers skip users without `chat.inbox`.
