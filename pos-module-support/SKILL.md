---
name: pos-module-support
description: Add a white-label support desk (email ticketing through a per-installation provider, threading, auto-assignment, SLA, push alerts, PWA at /support-desk) to a platformOS app with pos-module-support, or extend it through its hooks, events and overrides. Use when a platformOS app needs customer support, a helpdesk, ticketing, or a Zoho/Zendesk replacement.
---

# pos-module-support

## Install into an app
1. `pos-cli modules install support`, then deploy once so the tables, pages and seed migration are on the instance.
2. `pos-cli generate run modules/support/generators/install` — first support admin (+ `ADMIN_EMAILS`), optional `role_map`, `hook_headscripts` and `hook_support_branding` in `app/lib/hooks/`, email provider, API key, inbound hostname and the three secrets. It is safe to run again; it never edits the host's permissions file.
3. Deploy again if hook files were written; sign in at `/support-desk/sign-in` and finish Settings → Email (key, sending domain, inbound MX + Inbound Parse, test, delivery events, enable).

## Access model
- Membership records (`modules/support/team_member`, roles `agent`/`manager`/`admin`) are the only source of access. Host roles never grant ticket access, except: `superadmin` → admin on first visit; `ADMIN_EMAILS` → admin on first visit; `role_map` setting (host role → support role) when configured.
- Add people in Settings → Team (existing users or email invites). Do not add support permissions to the host's permissions file; the desk does not read them.

## Make it look like the app
- Colours, fonts and dark mode: the app's stylesheet returned by `app/lib/hooks/hook_headscripts.liquid` (common-styling `--pos-*` tokens win over the module CSS).
- Name, logos, icon, theme colour, sender name: `app/lib/hooks/hook_support_branding.liquid` returns `{app_name, short_name, logo_url, logo_dark_url, icon_url, favicon_url, theme_color, background_color, theme_mode, rail_theme, support_email_name}` (all optional; the sidebar logo is picked automatically from the sidebar colour, `rail_theme` pins it; no `app_name` → the instance domain); admins can override them in Settings → Branding, by upload or link; with no icon anywhere the desk draws a monogram PNG in an admin's browser and uses it as the app icon.
- Rail colours: `--pos-support-rail-*` and `--pos-support-monogram-*`. Status/priority/SLA colours are semantic `--pos-support-status-*`, `--pos-support-priority-*`, `--pos-support-sla-*` tokens with checked contrast.

## Extend
- Decide who gets a new ticket: `app/lib/hooks/hook_support_assignment_alter.liquid`; read `params.ticket`, set `params_to_modify.assignee_id` and `params_to_modify.reason`, and `return params_to_modify`. Without an assignee the module assigns the least-loaded available agent in the department.
- React to activity with consumers in `app/lib/consumers/<event>/<name>.liquid`. Events (ids only): `support_ticket_created`, `support_ticket_updated`, `support_ticket_status_changed` (from_value/to_value are status keys), `support_ticket_priority_changed`, `support_ticket_assigned`, `support_ticket_unassigned`, `support_ticket_merged`, `support_ticket_unmerged`, `support_ticket_linked`, `support_message_received`, `support_message_moved`, `support_reply_created`, `support_note_created`, `support_sla_due_soon`, `support_sla_breached`, `support_confirmation_waiting`.
- Override any page, partial or translation by copying it to `app/modules/support/public/...`.

## Rules that matter
- Read and write tickets only through `modules/support/queries/tickets/*` and `modules/support/commands/tickets/*`; they apply department scope, write the audit row (`ticket_event`) and publish the events. Load a ticket with `queries/tickets/find` (scoped to the member) before any command.
- Statuses are labels over fixed categories (`new`, `open`, `pending`, `on_hold`, `solved`, `closed`); behaviour follows the category. Add statuses in Settings → Statuses, not in code.
- Send customer email only through `modules/support/commands/messages/*` and `modules/support/commands/email/send`; they store the `Message-ID`, add the signed reply token and never include internal notes.
- Secrets live only in constants `modules/support/{EMAIL_API_KEY,INBOUND_SECRET,EVENTS_SECRET,REPLY_TOKEN_SECRET}`. Never change `REPLY_TOKEN_SECRET` on a live desk.
- Every POST under `/support-desk` checks `context.csrf_request_valid`; webhooks under `/api/support` authenticate by the secret path segment.
