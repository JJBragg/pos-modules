# 06 — Assignment and SLA

Requirements: AS-1..AS-8, SL-1..SL-7. Decisions D-7, D-8, D-14.

## 1. Agent availability (AS-1)

`team_member.availability`: `available`, `away`, `off`. Effective availability at time *t*:
```
if availability != available → not available
if working_hours present and t outside them (in the hours' time zone) → off
if paused_until > t → still available for assignment (pause silences notifications only)
```
The profile page and the queue avatar dot show the effective value.

## 2. Least-loaded assignment (AS-2, AS-3, AS-6)

Consumer `support_ticket_created/assign_new_ticket` → `commands/assignment/auto_assign`:

```
input: ticket (unassigned, not spam)
hook   : assign decision = { "assignee_id": null, "reason": null }
         function _ = 'modules/core/commands/hook/alter', hook: 'support_assignment', params: { "ticket": ticket }, params_to_modify: decision
         # host implements lib/hooks/hook_support_assignment_alter.liquid and sets params_to_modify.assignee_id / .reason (AS-7)
         if decision.assignee_id present → assign(decision.assignee_id, reason: decision.reason || "host rule") → done
agents : query agents/available_in_department(ticket.department_id)
         → each: profile_id, open_count (tickets with assignee_id = profile and category in [new, open]), max_open, last_assigned_at
filter : effective availability = available AND open_count < max_open
pick   : min open_count; tie → oldest last_assigned_at (null first); tie → lowest profile id
none   : leave unassigned; schedule escalation (§4)
assign : commands/tickets/assign(reason: "least-loaded in <dept short_code>: <open_count> open")
```

Concurrency: two tickets arriving together can pick the same agent. Accept it (counts self-correct on the next ticket) but serialise per department by running the consumer with `priority: high` and re-reading counts inside the command, not in the consumer.

Re-assignment triggers (AS-5): consumer on `support_message_received` — if the assignee's effective availability has been `off` for more than one business day (read `ticket_event` of type `availability_changed`), unassign and run `auto_assign` again; tell the previous assignee.

Manual assignment is always allowed (with a warning above the cap). "Assign to me" in the queue and ticket uses the same command with `reason: "manual"`.

## 3. SLA clock (SL-1..SL-7)

Policy resolution: `organization.sla_policy_id` → `department.sla_policy_id` → default policy. Targets in minutes per priority; `hours: calendar|business`.

Helpers in `lib/helpers/sla_clock.liquid`:
- `add_business_minutes(start, minutes, business_hours)` → datetime. Walk day by day in the policy time zone, skipping holidays; at most 400 iterations.
- `business_minutes_between(a, b, business_hours)` → integer (for reporting).

Rules:
- On create: `sla_first_reply_due_at = add(created_at, first)`, `sla_resolution_due_at = add(created_at, resolution)`; P3 resolution none.
- First public agent reply sets `first_replied_at`; first-reply SLA met/missed is final (reopen does not reset it).
- After every customer message while in `new`/`open`: `sla_next_reply_due_at = add(now, next)`; cleared by the next public agent reply.
- Category becomes `pending` or `on_hold` → `sla_paused_at = now`, `sla_state = paused`. Leaving it → `sla_paused_seconds += now − sla_paused_at`, shift `sla_resolution_due_at` by the pause, clear `sla_paused_at`.
- `solved`/`closed` → state `met` or `missed` against `sla_resolution_due_at`; reopen continues from the remaining time (SL-4).
- Priority change → recompute deadlines from `created_at` minus pauses.
- `sla_state` (SL-5): `overdue` if a running deadline is past; `due_soon` if < 25 % of the target remains; otherwise `on_track`. Queue shows the nearest running deadline.
- The acknowledgement email never counts as a reply (SL-3).

## 4. Timers (D-14)

`commands/sla/schedule(ticket)` after any change to deadlines:
```
sla_version += 1
for each running deadline d in [first_reply, next_reply, resolution]:
  background 'modules/support/commands/sla/check', ticket_id, deadline: d.name, version: sla_version,
             delay: max(0, minutes_until(d.due − 15 min)), kind: 'due_soon'
  background … delay: max(0, minutes_until(d.due)), kind: 'breach'
unassigned ticket:
  background 'modules/support/commands/assignment/escalate', ticket_id, stage: 'alert', delay: 15 (5 for p0)
  background … stage: 'assign_on_duty', delay: 30
```
Each job re-reads the ticket and exits silently when `sla_version` changed, the deadline was met, the ticket is solved/closed, or (escalate) it is assigned. A due-soon/breach job updates `sla_state`, writes a `ticket_event`, and publishes `support_sla_due_soon` / `support_sla_breached` (07 picks recipients).

Sweep (`commands/maintenance/sweep`, every 5 min, re-enqueues itself): for Confirmation tickets whose waiting period (`confirmation_wait_days`, counted from `solved_at`) has ended: in `auto_close` mode close them; in `keep_open` mode publish `support_confirmation_waiting` once per ticket (marked by a `ticket_event` of type `confirm_wait_notified`, cleared if the ticket leaves and re-enters Confirmation); un-snooze tickets past `snooze_until`; re-run missed SLA/escalation checks (deadline passed but `sla_state` not updated); write `setting.sweep_heartbeat`; once an hour, start `commands/ticket_stats/reconcile` in its own job (stored ticket counts, 03 `ticket_stat`). The Settings page warns when the heartbeat is older than 15 minutes; a migration starts the first sweep and a button in Settings → Integrations restarts it.

Verified in TASK-1 (decision-9): `delay` is in minutes and accepts fractions (0.05 min ran after ~4 s); delays of 30 and 90 days were accepted and scheduled (`admin_background_jobs` showed run_at +30 d / +90 d). No upper limit was hit, so no SLA deadline needs the sweep as a fallback; the sweep still re-checks missed deadlines.
