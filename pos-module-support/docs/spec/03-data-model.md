# 03 — Data model

Nineteen tables, all in `modules/support/public/schema/`. GraphQL addresses them as `modules/support/<name>`; a bare name writes fail and reads return zero rows. Property types are the closed set (string, integer, float, decimal, datetime, time, date, binary, boolean, array, address, file, photo, text, geojson, upload). JSON values are stored as `text` and read with `property_json`. Ids that point at other records are `string` (`*_id`). **People are user-module profiles** (D-22): `assignee_id`, `author_id` (agents), `actor_id`, `linked_by_id`, `account_owner_id` and `team_member.profile_id` hold profile ids; `contact.profile_id` links a contact to a host profile for chat/portal. Every column needed by Iterations 2–5 exists from day one so tickets never need a data migration.

Schemas below are written in YAML flow style for brevity. Write the real files in block style, like the existing modules (`- name: x` / `type: y` on separate lines), and validate each with `validate_code` before writing: an indentation slip or an unknown type fails the whole deploy. Avoid property names that collide with built-ins or keywords (`id`, `type`, `default`, `table`, `created_at`); that is why this file uses `event_type`, `is_default` and `reference_ids`. A property name has one type across every table of the instance, core's included (platformos-check `ConflictingSchemaPropertyType`): hence `counter.current`, `blocked_sender.pattern` and `inbound_email.params_json` (core's `status` already has a string `payload`).

## 1. Tables

### ticket.yml
```yaml
name: ticket
properties:
  - { name: number, type: integer }              # sequential per instance, from counter (§3)
  - { name: legacy_number, type: string }        # Zoho number after import (MG-2)
  - { name: subject, type: string }
  - { name: status_id, type: string }
  - { name: category, type: string }             # new|open|pending|on_hold|solved|closed, copied from status on every change
  - { name: priority, type: string }             # p0|p1|p2|p3
  - { name: department_id, type: string }
  - { name: organization_id, type: string }
  - { name: requester_id, type: string }         # contact id
  - { name: assignee_id, type: string }          # profile id; blank = unassigned
  - { name: channel, type: string }              # email|chat|portal|api|agent
  - { name: tags, type: array }
  - { name: needs_reply, type: boolean }         # customer wrote last (WS-1)
  - { name: last_customer_message_at, type: datetime }
  - { name: last_agent_reply_at, type: datetime }
  - { name: last_activity_at, type: datetime }
  - { name: first_replied_at, type: datetime }
  - { name: solved_at, type: datetime }
  - { name: closed_at, type: datetime }
  - { name: snooze_until, type: datetime }
  - { name: assigned_at, type: datetime }
  - { name: assignment_reason, type: string }    # "least-loaded in DOB: 3 open", "manual", "escalated: on-duty"
  - { name: sla_policy_id, type: string }
  - { name: sla_first_reply_due_at, type: datetime }
  - { name: sla_next_reply_due_at, type: datetime }
  - { name: sla_resolution_due_at, type: datetime }
  - { name: sla_due_at, type: datetime }        # nearest running deadline, for queue sorting (TASK-12)
  - { name: sla_paused_seconds, type: integer }  # accumulated pause for resolution clock
  - { name: sla_paused_at, type: datetime }
  - { name: sla_state, type: string }            # on_track|due_soon|overdue|met|missed|paused|none
  - { name: sla_version, type: integer }         # bumped when deadlines change; stale timer jobs exit
  - { name: merged_into_id, type: string }
  - { name: follow_up_of_id, type: string }
  - { name: ai_state, type: string }             # I4: none|handling|handed_off
  - { name: search_text, type: text }            # subject + requester + org + number, for fulltext
```

### message.yml
```yaml
name: message
properties:
  - { name: ticket_id, type: string }
  - { name: author_type, type: string }          # customer|agent|ai|system
  - { name: author_id, type: string }            # contact id or profile id
  - { name: visibility, type: string }           # public|internal
  - { name: channel, type: string }              # email|chat|portal|system
  - { name: kind, type: string }                 # message|note|event|status_update
  - { name: body_html, type: text }              # sanitised for display
  - { name: body_text, type: text }
  - { name: body_stripped, type: text }          # quoted history removed
  - { name: from_email, type: string }
  - { name: to_emails, type: array }
  - { name: cc_emails, type: array }
  - { name: subject, type: string }
  - { name: email_message_id, type: string }     # stored forever (D-4)
  - { name: in_reply_to, type: string }
  - { name: reference_ids, type: array }         # References header, in order
  - { name: inbound_email_id, type: string }     # raw source ("Show original")
  - { name: match_reason, type: string }         # token|header|subject|new|follow_up|moved
  - { name: delivery_state, type: string }       # queued|sent|delivered|bounced|dropped|failed
  - { name: delivery_error, type: string }
  - { name: auth_results, type: text }           # JSON {spf, dkim, spam_score}
  - { name: moved_from_ticket_id, type: string } # WS-14 undo
  - { name: event_payload, type: text }          # JSON for kind=event (status change etc.)
```

### attachment.yml
```yaml
name: attachment
properties:
  - { name: message_id, type: string }
  - { name: ticket_id, type: string }
  - { name: file, type: upload, options: { acl: private, content_length: { lte: 35840 } } }   # KiB, 35 MB
  - { name: filename, type: string }
  - { name: content_type, type: string }
  - { name: size, type: integer }
  - { name: content_id, type: string }           # inline images (cid:)
  - { name: inline, type: boolean }
```

### participant.yml — CCs and followers
```yaml
name: participant
properties:
  - { name: ticket_id, type: string }
  - { name: contact_id, type: string }
  - { name: profile_id, type: string }
  - { name: email, type: string }
  - { name: role, type: string }                 # cc|follower
```

### status.yml
```yaml
name: status
properties:
  - { name: key, type: string }                  # stable machine key: new, review, progress, customer, deploy, hold, confirm, closed, spam
  - { name: label, type: string }
  - { name: customer_label, type: string }
  - { name: category, type: string }             # fixed set (D-5)
  - { name: color, type: string }                # semantic token name, not a hex (WL-8)
  - { name: position, type: integer }
  - { name: system, type: boolean }              # New, Closed, Spam cannot be deleted
  - { name: active, type: boolean }
```

### department.yml
```yaml
name: department
properties:
  - { name: name, type: string }
  - { name: short_code, type: string }
  - { name: inbound_local_part, type: string }   # "dob" → dob@<inbound domain>
  - { name: public_address, type: string }       # support-dob@platformos.com (display only)
  - { name: from_name, type: string }
  - { name: from_address, type: string }         # must be on a SendGrid-authenticated domain
  - { name: signature_html, type: text }
  - { name: sla_policy_id, type: string }
  - { name: is_default, type: boolean }
  - { name: active, type: boolean }
```

### contact.yml
```yaml
name: contact
properties:
  - { name: name, type: string }
  - { name: emails, type: array }                # lower-cased; first is primary
  - { name: organization_id, type: string }
  - { name: phone, type: string }
  - { name: profile_id, type: string }           # host profile, for chat/portal (I3)
  - { name: bounced, type: boolean }
  - { name: blocked, type: boolean }
```

### organization.yml
```yaml
name: organization
properties:
  - { name: name, type: string }
  - { name: domains, type: array }
  - { name: tier, type: string }
  - { name: sla_policy_id, type: string }
  - { name: share_tickets, type: boolean }       # I3 portal
  - { name: account_owner_id, type: string }     # later (sticky routing)
```

### sla_policy.yml
```yaml
name: sla_policy
properties:
  - { name: name, type: string }
  - { name: targets, type: text }                # JSON {p0:{first:30,next:60,resolution:1440,hours:"calendar"}, …} minutes
  - { name: business_hours, type: text }         # JSON {tz:"America/Chicago", days:{mon:["09:00","17:00"],…}, holidays:["2026-12-25"]}
  - { name: is_default, type: boolean }
```

### saved_reply.yml
```yaml
name: saved_reply
properties:
  - { name: title, type: string }
  - { name: body_html, type: text }              # supports {{ requester.first_name }} style variables, rendered with a whitelist
  - { name: actions, type: text }                # JSON {status_key, priority}
  - { name: department_id, type: string }        # blank = all
```

### escalation_link.yml — MVP stores URL; I2 fills the rest
```yaml
name: escalation_link
properties:
  - { name: ticket_id, type: string }
  - { name: provider, type: string }             # github
  - { name: issue_url, type: string }
  - { name: issue_ref, type: string }            # owner/repo#123
  - { name: issue_node_id, type: string }
  - { name: project_item_id, type: string }
  - { name: last_status, type: string }
  - { name: linked_by_id, type: string }
```

### ticket_event.yml — audit log and reporting source
```yaml
name: ticket_event
properties:
  - { name: ticket_id, type: string }
  - { name: actor_type, type: string }           # user|system|customer|ai
  - { name: actor_id, type: string }
  - { name: event_type, type: string }           # created|status_changed|assigned|priority_changed|merged|moved|sla_state|notified|…
  - { name: from_value, type: string }
  - { name: to_value, type: string }
  - { name: reason, type: string }
```

### inbound_email.yml
```yaml
name: inbound_email
properties:
  - { name: params_json, type: text }            # JSON of every provider field except the raw email
  - { name: raw_mime, type: text }               # when the raw option is used
  - { name: message_id_header, type: string }    # idempotency
  - { name: state, type: string }                # received|processed|ignored|failed
  - { name: ignored_reason, type: string }       # auto_reply|loop|spam|blocked|duplicate
  - { name: error, type: text }
  - { name: ticket_id, type: string }
  - { name: message_id, type: string }
```

### team_member.yml — one per support team member (keyed by profile_id; the only thing that grants desk access, D-12/D-24)
```yaml
name: team_member
properties:
  - { name: profile_id, type: string }
  - { name: role, type: string }                 # agent|manager|admin
  - { name: state, type: string }                # invited|active|disabled
  - { name: source, type: string }               # install|invite|request|role_map|superadmin|recovery
  - { name: created_by_id, type: string }        # profile id; blank for install/superadmin/role_map
  - { name: disabled_at, type: datetime }
  - { name: disabled_by_id, type: string }
  - { name: job_title, type: string }            # shown on the Team page and in the ticket sidebar
  - { name: availability, type: string }         # available|away|off
  - { name: department_ids, type: array }        # ignored for admin (sees every department)
  - { name: max_open, type: integer }            # default 15
  - { name: working_hours, type: text }          # JSON, same shape as business_hours; blank = always
  - { name: last_assigned_at, type: datetime }
  - { name: notification_prefs, type: text }     # JSON {new:{push:true,email:true}, assigned:{…}, …}; missing key = true (D-10)
  - { name: paused_until, type: datetime }       # "Pause all"; far future = until turned on
  - { name: on_duty_manager, type: boolean }
```

### team_invite.yml — pending invitation (D-25)
```yaml
name: team_invite
properties:
  - { name: email, type: string }                # lower-cased
  - { name: profile_id, type: string }           # the account created (roles: []) or found for this email
  - { name: role, type: string }
  - { name: department_ids, type: array }
  - { name: token_digest, type: string }         # sha256 of the token; the raw token only travels in the email
  - { name: expires_at, type: datetime }         # +7 days
  - { name: accepted_at, type: datetime }
  - { name: revoked_at, type: datetime }
  - { name: invited_by_id, type: string }
```

### access_request.yml — "Request access" from a signed-in non-member (D-24)
```yaml
name: access_request
properties:
  - { name: profile_id, type: string }
  - { name: note, type: text }                   # optional, max 500 chars
  - { name: state, type: string }                # pending|approved|declined
  - { name: decided_by_id, type: string }
  - { name: decided_at, type: datetime }
```
One pending request per profile; a new request within 24 h of a decline is refused.

### blocked_sender.yml — blocklist (D-27)
```yaml
name: blocked_sender
properties:
  - { name: pattern, type: string }              # lower-cased address "x@y.com" or domain "y.com"
  - { name: kind, type: string }                 # address|domain
  - { name: reason, type: string }
  - { name: source, type: string }               # manual|spam_mark
  - { name: ticket_id, type: string }            # the ticket marked as spam, when source = spam_mark
  - { name: created_by_id, type: string }
  - { name: hits, type: integer }                # emails refused since blocking
  - { name: last_hit_at, type: datetime }
```

### setting.yml — key/value configuration
```yaml
name: setting
properties:
  - { name: key, type: string }                  # email_provider, inbound_domain, email_status, confirmation_mode (auto_close|keep_open), confirmation_wait_days, staff_roles (default: roles granting admin_pages.view), role_map (JSON host role → support role, default {}), previous_inbound_secret + previous_secret_expires_at (D-28), unassigned_alert_minutes, unassigned_alert_minutes_p0, escalate_after_minutes, free_mail_domains, spam_threshold, branding_override, sweep_heartbeat, inbound_domain, …
  - { name: value, type: text }                  # JSON
```

### counter.yml
```yaml
name: counter
properties:
  - { name: key, type: string }                  # ticket_number
  - { name: current, type: integer }
```

### ticket_stat.yml — stored ticket counts for the rail
```yaml
name: ticket_stat
properties:
  - { name: key, type: string }                  # department_id, or "department_id|assignee_id"
  - { name: department_id, type: string }
  - { name: assignee_id, type: string }          # absent on the department row
  - { name: counts, type: text }                 # JSON; department row: open, needs_reply, unassigned, all_open, waiting, awaiting_confirmation, sla_at_risk, deploy, closed; assignee row: mine
  - { name: counted_at, type: datetime }         # when the counting job started; an older job never overwrites a newer row
```
Every ticket write that changes `category`, `status_id`, `assignee_id`, `department_id`, `needs_reply` or `sla_state` (`commands/tickets/{create,save}`, `commands/sla/{update,check}`) schedules `commands/ticket_stats/recount` in the background for the department and the department|assignee pair before and after the change. The job counts those tickets again rather than adding or subtracting, so a retried or lost job cannot leave a row off for good. `commands/ticket_stats/reconcile` counts everything again from the install migration and from the sweep once an hour, and stores `setting.ticket_stats_counted_at`. The rail, the attention strip and department counts read these rows in one query (`queries/ticket_stats/rail`). Until the first full count, and for department counts of a view narrowed by a filter, `queries/tickets/rail_counts` counts live and caches for a minute.

## 2. Indexing and querying

- Every queue query filters `table`, `category` (not `closed`), and department scope, sorted by `sla_*_due_at` ascending through `sort: [{ properties: [{ name: "…", order: ASC }] }]`.
- Search uses `filter: { fulltext: … }` over `search_text` plus exact `number` match.
- `records` always has `per_page`; lists cap at 100 and paginate.
- Guard every non-null variable before the `{% graphql %}` tag.

## 3. Ticket numbers

`counter` row `ticket_number`, incremented with `record_update(id, record: { properties: [{ name: "current", increment: 1 }] })` and the returned value used as the number. Atomic operations only work on `record_update`; the counter row is created by the seed migration with `value_int` = highest Zoho number after import (MG-2).

## 4. Status categories (code, not data)

`lib/helpers/categories.liquid` returns:

```json
{
  "new":     { "sla": "running", "customer_reply": "needs_reply", "customer_visible": true },
  "open":    { "sla": "running", "customer_reply": "needs_reply", "customer_visible": true },
  "pending": { "sla": "paused",  "customer_reply": "to_status:progress", "customer_visible": true },
  "on_hold": { "sla": "paused",  "customer_reply": "needs_reply", "customer_visible": false },
  "solved":  { "sla": "stopped", "customer_reply": "to_status:progress", "customer_visible": true },
  "closed":  { "sla": "stopped", "customer_reply": "follow_up", "customer_visible": true }
}
```

Seeded statuses (migration): New (new, system), Under review (open), In progress (open), Waiting on customer (pending), Waiting on deploy (on_hold), On hold (on_hold), Confirmation (solved), Closed (closed, system), Spam (closed, system). Customer labels per the detailed PRD table.
