// Board (D-26): drag a card to another column, or use its "Move to" form.
// Both post to /support-desk/board/move; with respond=json the server answers
// with JSON instead of a redirect. The card moves before the answer arrives
// and goes back when the move is refused; it is re-fetched afterwards. Changes
// from the queue rooms refresh cards the same way.
import { createConsumer } from './vendor/actioncable-8.0.100.esm.js';

const root = document.querySelector('[data-support-board]');
if (root) {
  const priorityRank = { p0: 0, p1: 1, p2: 2, p3: 3 };
  // columns are priorities or statuses; a card belongs to the column of its priority or status
  const byPriority = root.dataset.supportGroup === 'priority';
  const keyOf = (card) => (byPriority ? card.dataset.priority : card.dataset.statusKey);
  const column = (key) => root.querySelector(`.pos-support-column[data-group-key="${CSS.escape(key)}"]`);
  const cardFor = (id) => root.querySelector(`.pos-support-card[data-ticket-id="${CSS.escape(id)}"]`);
  // the same message is not stacked again while it is still on screen
  let lastToast = { message: null, at: 0 };
  const toast = (kind, message) => {
    if (message === lastToast.message && Date.now() - lastToast.at < 5000) return;
    lastToast = { message, at: Date.now() };
    if (window.pos && window.pos.modules && window.pos.modules.toast) new window.pos.modules.toast(kind, message);
  };
  const adjustCount = (col, delta) => {
    const count = col && col.querySelector('[data-count]');
    if (count) count.textContent = Math.max(0, Number(count.textContent) + delta);
  };

  // Insert by priority, then newest first: the order the server uses.
  const place = (card, col) => {
    const cards = col.querySelector('[data-cards]');
    const rank = priorityRank[card.dataset.priority] ?? 9;
    const created = Number(card.dataset.created);
    const before = Array.from(cards.children).find((other) => {
      const otherRank = priorityRank[other.dataset.priority] ?? 9;
      return otherRank > rank || (otherRank === rank && Number(other.dataset.created) < created);
    });
    cards.insertBefore(card, before || null);
  };

  // Fetch the card again. It is dropped when the ticket left the member's
  // scope or moved to a column that is not shown.
  const refresh = async (ticketId, attempt = 1) => {
    // the board's view and filters go along: a ticket outside them answers 204 and its card is dropped
    const query = root.dataset.supportQuery ? `&${root.dataset.supportQuery}&layout=board` : '';
    const response = await fetch(`/support-desk/tickets/${encodeURIComponent(ticketId)}/card?group=${byPriority ? 'priority' : 'status'}${query}`, { credentials: 'same-origin' }).catch(() => null);
    // a failed fetch (busy server, rate limit) keeps the card and tries again;
    // only an answer without a card removes it
    if (!response || (!response.ok && response.status !== 404)) {
      if (attempt < 3) setTimeout(() => refresh(ticketId, attempt + 1), 2000 * attempt);
      return;
    }
    const existing = cardFor(ticketId);
    const from = existing && existing.closest('.pos-support-column');
    let card = null;
    let target = null;
    if (response.ok && response.status !== 204) {
      const template = document.createElement('template');
      template.innerHTML = (await response.text()).trim();
      card = template.content.querySelector('.pos-support-card');
      if (card) target = column(keyOf(card));
    }
    if (existing) existing.remove();
    if (card && target) {
      card.classList.add('pos-support-row-fresh');
      bind(card);
      place(card, target);
    }
    if (from !== target) {
      adjustCount(from, -1);
      if (card) adjustCount(target, 1);
    }
  };

  // The card moves at once; it goes back to where it was if the server
  // refuses, and is re-fetched afterwards for its final content and place.
  const move = async (card, key) => {
    const form = card.querySelector('form.pos-support-move');
    const data = new FormData(form);
    data.delete('status_key');
    data.delete('priority');
    data.set(byPriority ? 'priority' : 'status_key', key);
    data.set('respond', 'json');

    const from = card.closest('.pos-support-column');
    const nextSibling = card.nextElementSibling;
    const target = column(key);
    const field = byPriority ? 'priority' : 'statusKey';
    const previousKey = card.dataset[field];
    if (target && target !== from) {
      card.dataset[field] = key;
      place(card, target);
      adjustCount(from, -1);
      adjustCount(target, 1);
    }
    card.setAttribute('aria-busy', 'true');
    let error = null;
    try {
      const response = await fetch(form.action, { method: 'POST', body: data, credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.ok) error = body.error || root.dataset.supportMoveError;
    } catch (e) {
      error = root.dataset.supportMoveError;
    }
    card.removeAttribute('aria-busy');
    if (error) {
      if (target && target !== from) {
        card.dataset[field] = previousKey;
        const cards = from.querySelector('[data-cards]');
        cards.insertBefore(card, nextSibling && nextSibling.parentNode === cards ? nextSibling : null);
        adjustCount(target, -1);
        adjustCount(from, 1);
      }
      toast('error', error);
    } else {
      toast('success', root.dataset.supportMoved);
    }
    refresh(card.dataset.ticketId);
  };

  const bind = (card) => {
    card.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/plain', card.dataset.ticketId);
      event.dataTransfer.effectAllowed = 'move';
    });
    const form = card.querySelector('form.pos-support-move');
    if (form) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        move(card, (form.elements.priority || form.elements.status_key).value);
      });
    }
  };
  root.querySelectorAll('.pos-support-card').forEach(bind);

  root.querySelectorAll('.pos-support-column').forEach((col) => {
    col.addEventListener('dragover', (event) => { event.preventDefault(); col.classList.add('pos-support-drop-target'); });
    col.addEventListener('dragleave', (event) => { if (!col.contains(event.relatedTarget)) col.classList.remove('pos-support-drop-target'); });
    col.addEventListener('drop', (event) => {
      event.preventDefault();
      col.classList.remove('pos-support-drop-target');
      const card = cardFor(event.dataTransfer.getData('text/plain'));
      if (card && card.closest('.pos-support-column') !== col) move(card, col.dataset.groupKey);
    });
  });

  // Live: cards on the board follow changes made elsewhere; the card endpoint
  // decides from the board's view and filters whether a ticket belongs on it.
  const departments = (root.dataset.supportDepartments || '').split(',').filter(Boolean);
  if (departments.length && window.pos && window.pos.csrfToken) {
    const consumer = createConsumer(() => `/websocket?authenticity_token=${encodeURIComponent(window.pos.csrfToken)}`);
    // several messages for one change are merged into one card fetch
    const timers = new Map();
    const received = (data) => {
      if (!data.ticket_id) return;
      clearTimeout(timers.get(data.ticket_id));
      timers.set(data.ticket_id, setTimeout(() => {
        timers.delete(data.ticket_id);
        refresh(data.ticket_id);
      }, 500));
    };
    departments.forEach((id) => consumer.subscriptions.create({ channel: 'support', room_id: `queue-${id}` }, { received }));
  }
}
