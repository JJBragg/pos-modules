// Live updates and presence (05 §4) over the platformOS "support" channel.
// Rooms: queue-<department>, ticket-<id>, profile-<id>. Payloads carry ids;
// rows and pages are fetched from the desk, which checks access again.
import { createConsumer } from './vendor/actioncable-8.0.100.esm.js';

const root = document.querySelector('[data-support-live]');
if (root && window.pos && window.pos.csrfToken) {
  const consumer = createConsumer(() => `/websocket?authenticity_token=${encodeURIComponent(window.pos.csrfToken)}`);
  const subscribe = (room, received, connected) => consumer.subscriptions.create(
    { channel: 'support', room_id: room },
    { received, connected }
  );
  const text = (key, fallback) => root.dataset[key] || fallback;

  // Queue: refresh changed rows; new tickets go to the top of their swim lane
  // (the lane of their priority or status), or of the first lane when theirs is not shown.
  const tbody = document.querySelector('.pos-support-table tbody');
  const departments = (root.dataset.supportDepartments || '').split(',').filter(Boolean);
  const laneFor = (row) => {
    const key = root.dataset.supportGroup === 'status' ? row.dataset.statusKey : row.dataset.priority;
    return document.querySelector(`.pos-support-lane[data-lane="${CSS.escape(key || '')}"]`) || tbody;
  };
  // once the page is being left (a form was sent), rows are not fetched any more:
  // requests racing the redirect could take the one-time flash message
  let leaving = false;
  document.addEventListener('submit', (event) => { if (!event.defaultPrevented) leaving = true; });
  window.addEventListener('pagehide', () => { leaving = true; });
  const rowOf = (ticketId) => document.querySelector(`.pos-support-row [value="${CSS.escape(ticketId)}"]`)?.closest('tr');
  const refreshRow = async (ticketId, kind, attempt = 1) => {
    if (leaving) return;
    if (!rowOf(ticketId) && (kind !== 'created' || root.dataset.supportFirstPage !== 'true')) return;
    const response = await fetch(`/support-desk/tickets/${encodeURIComponent(ticketId)}/row`, { credentials: 'same-origin' }).catch(() => null);
    // messages for one change are merged into this one fetch, so a failed
    // fetch (busy server, rate limit) is tried again once
    if (!response || (!response.ok && response.status !== 404)) {
      if (attempt < 3) setTimeout(() => refreshRow(ticketId, kind, attempt + 1), 2000 * attempt);
      return;
    }
    if (!response.ok) return;
    const template = document.createElement('template');
    template.innerHTML = (await response.text()).trim();
    const row = template.content.querySelector('tr');
    if (!row) return;
    row.classList.add('pos-support-row-fresh');
    // look the row up again: another update may have replaced it while this one was loading
    const existing = rowOf(ticketId);
    const lane = laneFor(row);
    if (existing && existing.closest('tbody') === lane) {
      existing.replaceWith(row);
      return;
    }
    if (existing) existing.remove();
    if (!lane) return;
    const head = lane.querySelector('.pos-support-lane-head');
    if (head) head.after(row);
    else lane.prepend(row);
  };
  // one change often arrives as several messages (the command, then its
  // consumers): fetch the row once per ticket within half a second
  const pending = new Map();
  const queueRefresh = (ticketId, kind) => {
    const previous = pending.get(ticketId);
    if (previous) clearTimeout(previous.timer);
    const created = kind === 'created' || (previous && previous.kind === 'created');
    const timer = setTimeout(() => {
      pending.delete(ticketId);
      refreshRow(ticketId, created ? 'created' : kind);
    }, 500);
    pending.set(ticketId, { timer, kind: created ? 'created' : kind });
  };
  if (tbody) {
    departments.forEach((id) => subscribe(`queue-${id}`, (data) => queueRefresh(data.ticket_id, data.kind)));
  }

  // Ticket page: presence and the new-message guard.
  const ticketId = root.dataset.supportTicket;
  if (ticketId) {
    const presence = document.querySelector('[data-support-presence]');
    const composer = document.querySelector('[data-support-composer]');
    const body = composer && composer.querySelector('textarea[name="body"]');
    const others = new Map();
    const me = root.dataset.supportMe;
    const renderPresence = () => {
      if (!presence) return;
      const now = Date.now();
      const names = [];
      others.forEach((entry, id) => {
        if (now - entry.at > 45000 || entry.state === 'left') { others.delete(id); return; }
        names.push(`${entry.name} ${entry.state === 'replying' ? text('supportReplying', 'is replying') : text('supportViewing', 'is viewing')}`);
      });
      presence.textContent = names.join(' · ');
      presence.hidden = names.length === 0;
    };
    const state = () => (body && (document.activeElement === body || body.value.trim() !== '') ? 'replying' : 'viewing');
    let room = null;
    room = subscribe(`ticket-${ticketId}`, (data) => {
      if (data.kind === 'presence') {
        if (data.profile_id !== me) { others.set(data.profile_id, { name: data.name, state: data.state, at: Date.now() }); renderPresence(); }
        return;
      }
      // A customer message, or a reply sent by someone else, while this agent may be writing.
      const fromOther = data.kind === 'reply' && data.actor_id && data.actor_id !== me;
      if ((data.kind === 'message' || fromOther) && composer) {
        const warning = document.querySelector('[data-support-new-message]');
        if (warning) {
          warning.hidden = false;
          const ack = warning.querySelector('input[type="checkbox"]');
          if (ack) { ack.checked = false; ack.required = true; }
        }
      }
    }, () => room && room.send({ state: state() }));
    // the heartbeat runs only while the tab is visible: a hidden tab drops out
    // of the others' presence after 45 s and is announced again when shown
    let heartbeat = null;
    const beat = () => { room.send({ state: state() }); renderPresence(); };
    const startBeat = () => { if (!heartbeat) heartbeat = setInterval(beat, 20000); };
    const stopBeat = () => { clearInterval(heartbeat); heartbeat = null; };
    if (document.visibilityState === 'visible') startBeat();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { beat(); startBeat(); } else stopBeat();
    });
    if (body) body.addEventListener('focus', () => room.send({ state: 'replying' }));
    window.addEventListener('pagehide', () => { stopBeat(); room.send({ state: 'left' }); });
  }

  // Personal room: short in-app notice for assignments, and the result of a
  // bulk change, which arrives in chunks and is reported once all are in.
  const profileId = root.dataset.supportMe;
  const batches = new Map();
  const toast = (kind, message) => {
    if (window.pos.modules && window.pos.modules.toast) new window.pos.modules.toast(kind, message);
  };
  if (profileId) {
    subscribe(`profile-${profileId}`, (data) => {
      if (data.kind === 'assigned') {
        toast('info', `${text('supportAssignedToYou', 'Assigned to you')}: #${data.number}`);
        return;
      }
      if (data.kind !== 'bulk') return;
      const batch = batches.get(data.batch) || { seen: 0, changed: 0, failed: 0, numbers: [] };
      batch.seen += 1;
      batch.changed += data.changed;
      batch.failed += data.failed;
      batch.numbers.push(...(data.failed_numbers || []));
      batches.set(data.batch, batch);
      if (batch.seen < data.chunks) return;
      batches.delete(data.batch);
      // one / many wording; a ticket outside the member's scope has no number to show
      const pick = (count, one, many, fallback) => (count === 1 ? text(one, fallback) : text(many, fallback));
      if (batch.changed > 0) {
        toast('success', pick(batch.changed, 'supportBulkDoneOne', 'supportBulkDone', '{count} tickets updated.').replace('{count}', batch.changed));
      }
      if (batch.failed > 0) {
        const numbers = batch.numbers.map((n) => `#${n}`).join(', ');
        const message = numbers
          ? pick(batch.failed, 'supportBulkFailedOne', 'supportBulkFailed', '{count} tickets could not be changed: {numbers}')
          : pick(batch.failed, 'supportBulkUnavailableOne', 'supportBulkUnavailable', '{count} tickets could not be changed.');
        toast('error', message.replace('{count}', batch.failed).replace('{numbers}', numbers));
      }
    });
  }
}
