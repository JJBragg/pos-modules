// Board (D-26): drag a card to another column to change its status or
// priority; the assignee button on each card opens the assignee picker.
// Both post to /support-desk/board/move with respond=json, so the server
// answers with JSON instead of a redirect. The card changes before the answer
// arrives, goes back when the change is refused, and is re-fetched afterwards.
// Changes from the queue rooms refresh cards the same way.
import { createConsumer } from './vendor/actioncable-8.0.100.esm.js';

const root = document.querySelector('[data-support-board]');
if (root) {
  const priorityRank = { p0: 0, p1: 1, p2: 2, p3: 3 };
  // columns are priorities or statuses; a card belongs to the column of its priority or status
  const byPriority = root.dataset.supportGroup === 'priority';
  const keyOf = (card) => (byPriority ? card.dataset.priority : card.dataset.statusKey);
  const column = (key) => root.querySelector(`.pos-support-column[data-group-key="${CSS.escape(key)}"]`);
  const cardFor = (id) => root.querySelector(`.pos-support-card[data-ticket-id="${CSS.escape(id)}"]`);
  const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const named = (template, name) => (template || '').replace('__NAME__', name);
  const hasToast = () => window.pos && window.pos.modules && window.pos.modules.toast;
  // the same message is not stacked again while it is still on screen
  let lastToast = { message: null, at: 0 };
  const toast = (kind, message) => {
    if (message === lastToast.message && Date.now() - lastToast.at < 5000) return;
    lastToast = { message, at: Date.now() };
    if (hasToast()) new window.pos.modules.toast(kind, escapeHtml(message));
  };
  const adjustCount = (col, delta) => {
    const count = col && col.querySelector('[data-count]');
    if (count) count.textContent = Math.max(0, Number(count.textContent) + delta);
  };

  // answers null on success, else the server's message or the fallback
  const send = async (fields, fallback) => {
    let failed = false;
    const data = new FormData();
    data.set('authenticity_token', root.dataset.supportToken || (window.pos && window.pos.csrfToken) || '');
    data.set('respond', 'json');
    Object.entries(fields).forEach(([name, value]) => data.set(name, value));
    let error = null;
    try {
      const response = await fetch('/support-desk/board/move', { method: 'POST', body: data, credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.ok) { failed = true; error = body.error; }
    } catch (e) {
      failed = true;
    }
    return failed ? (error || fallback) : null;
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
    // keyboard focus on the assignee button stays on it when the card is replaced
    const focusAssign = existing && existing.contains(document.activeElement) && document.activeElement.matches('[data-support-assign]');
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
      if (focusAssign) card.querySelector('[data-support-assign]')?.focus();
    }
    if (from !== target) {
      adjustCount(from, -1);
      if (card) adjustCount(target, 1);
    }
  };

  // The card moves at once; it goes back to where it was if the server
  // refuses, and is re-fetched afterwards for its final content and place.
  const move = async (card, key) => {
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
    const fields = { ticket_id: card.dataset.ticketId };
    fields[byPriority ? 'priority' : 'status_key'] = key;
    const error = await send(fields, root.dataset.supportMoveError);
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
      card.classList.add('pos-support-dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('pos-support-dragging'));
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

  // ------------------------------------------------------------------
  // Assignee picker. The options are rendered once per board
  // (board/assign_people); each card's picker keeps the people who may take
  // that card's ticket. Choosing applies at once; the toast offers Undo.
  // Without JavaScript the button is a link to the ticket's assignee field.
  // ------------------------------------------------------------------
  const people = root.querySelector('template[data-support-assign-people]');
  if (people) {
    const me = people.dataset.me;
    const canManage = people.dataset.canManage === 'true';
    const SEARCH_FROM = 8;
    let open = null;
    let uid = 0;

    const optionFor = (value) => people.content.querySelector(`[role="option"][data-person][data-value="${CSS.escape(value)}"]`)
      || (value === me ? people.content.querySelector('[role="option"][data-me]') : null);
    const nameFor = (value) => {
      const option = optionFor(value);
      return option ? option.dataset.name : '';
    };
    const buttonFor = (ticketId) => cardFor(ticketId)?.querySelector('[data-support-assign]');

    const enhanceButton = (button) => {
      button.setAttribute('role', 'button');
      button.setAttribute('aria-haspopup', 'listbox');
      button.setAttribute('aria-expanded', 'false');
    };
    root.querySelectorAll('[data-support-assign]').forEach(enhanceButton);
    new MutationObserver(() => root.querySelectorAll('[data-support-assign]:not([role])').forEach(enhanceButton))
      .observe(root, { childList: true, subtree: true });

    // the button's look and name before the server answers
    const showAssignee = (button, value) => {
      const option = value ? optionFor(value) : people.content.querySelector('[role="option"][data-unassign]');
      const mark = option && option.querySelector('.pos-support-avatar');
      if (mark) button.replaceChildren(mark.cloneNode(true));
      button.dataset.assigneeId = value;
      const label = value ? named(root.dataset.supportAssignChange, nameFor(value)) : root.dataset.supportAssignNone;
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
    };

    const assign = async (ticketId, value, previous, { undoable }) => {
      const button = buttonFor(ticketId);
      const before = button ? { nodes: Array.from(button.childNodes).map((n) => n.cloneNode(true)), label: button.getAttribute('aria-label') } : null;
      if (button) {
        showAssignee(button, value);
        button.setAttribute('aria-busy', 'true');
      }
      const error = await send({ ticket_id: ticketId, change: 'assign', assignee_id: value }, root.dataset.supportAssignError);
      const current = buttonFor(ticketId);
      if (current) current.removeAttribute('aria-busy');
      if (error) {
        if (current && before) {
          current.replaceChildren(...before.nodes);
          current.dataset.assigneeId = previous;
          current.setAttribute('aria-label', before.label);
          current.setAttribute('title', before.label);
        }
        toast('error', error);
      } else {
        const name = nameFor(value);
        const message = value ? named(root.dataset.supportAssigned, name || '') : root.dataset.supportUnassigned;
        // an agent may only take a ticket or give up their own: Undo only where the server allows it
        const canUndo = undoable && (canManage || previous === '' || previous === me);
        if (canUndo && hasToast()) {
          const note = new window.pos.modules.toast('success', `${escapeHtml(message)} <button type="button" class="pos-support-toast-undo">${escapeHtml(root.dataset.supportUndo)}</button>`);
          note.settings.notification?.querySelector('.pos-support-toast-undo')?.addEventListener('click', () => {
            note.hide();
            assign(ticketId, previous, value, { undoable: false });
          }, { once: true });
        } else {
          toast('success', message);
        }
      }
      refresh(ticketId);
    };

    const close = (returnFocus) => {
      if (!open) return;
      const { button, pop } = open;
      open = null;
      pop.remove();
      button.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      if (returnFocus && button.isConnected) button.focus();
    };
    const onOutside = (event) => {
      if (open && !open.pop.contains(event.target) && !open.button.contains(event.target)) close(false);
    };
    const onScroll = (event) => {
      if (open && !open.pop.contains(event.target)) close(false);
    };
    const onResize = () => close(false);

    const position = (button, pop) => {
      const rect = button.getBoundingClientRect();
      const margin = 8;
      const width = pop.offsetWidth;
      const height = pop.offsetHeight;
      let left = rect.right - width;
      left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
      let top = rect.bottom + 4;
      if (top + height > window.innerHeight - margin && rect.top - height - 4 >= margin) top = rect.top - height - 4;
      pop.style.left = `${left}px`;
      pop.style.top = `${Math.max(margin, top)}px`;
    };

    const openPicker = (button) => {
      close(false);
      const card = button.closest('.pos-support-card');
      const ticketId = card.dataset.ticketId;
      const current = button.dataset.assigneeId || '';
      const department = button.dataset.departmentId;

      const pop = document.createElement('div');
      pop.className = 'pos-support-assign-pop';
      const list = document.createElement('ul');
      list.id = `pos-support-assign-list-${++uid}`;
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', button.getAttribute('aria-label'));

      people.content.querySelectorAll('[role="option"]').forEach((source) => {
        const value = source.dataset.value;
        if (source.hasAttribute('data-me')) {
          if (current === me) return;
        } else if (source.hasAttribute('data-person')) {
          // agents serve their departments; managers and admins every department; the current assignee stays listed
          const departments = (source.dataset.departments || '').split(',');
          if (source.dataset.role === 'agent' && !departments.includes(department) && value !== current) return;
        } else if (source.hasAttribute('data-unassign')) {
          if (!current || (!canManage && current !== me)) return;
        }
        const option = source.cloneNode(true);
        option.id = `${list.id}-${list.children.length}`;
        option.setAttribute('aria-selected', String(value !== '' && value === current));
        if (option.hasAttribute('data-unassign') && !canManage) {
          option.querySelector('.pos-support-assign-name').textContent = option.dataset.labelOwn;
        }
        list.append(option);
      });

      const empty = document.createElement('p');
      empty.className = 'pos-support-assign-empty pos-supplementary';
      empty.textContent = root.dataset.supportAssignEmpty;
      empty.hidden = true;

      let search = null;
      if (list.children.length >= SEARCH_FROM) {
        search = document.createElement('input');
        search.type = 'search';
        search.className = 'pos-support-assign-search';
        search.placeholder = root.dataset.supportAssignSearch;
        search.setAttribute('aria-label', root.dataset.supportAssignSearch);
        search.setAttribute('role', 'combobox');
        search.setAttribute('aria-expanded', 'true');
        search.setAttribute('aria-controls', list.id);
        search.setAttribute('aria-autocomplete', 'list');
        search.autocomplete = 'off';
        pop.append(search);
      } else {
        list.tabIndex = 0;
      }
      pop.append(list, empty);
      document.body.append(pop);
      button.setAttribute('aria-expanded', 'true');

      const focusTarget = search || list;
      const visible = () => Array.from(list.children).filter((o) => !o.hidden);
      let active = null;
      const activate = (option) => {
        if (active) active.classList.remove('pos-support-richselect-active');
        active = option;
        if (option) {
          option.classList.add('pos-support-richselect-active');
          focusTarget.setAttribute('aria-activedescendant', option.id);
          option.scrollIntoView({ block: 'nearest' });
        } else {
          focusTarget.removeAttribute('aria-activedescendant');
        }
      };
      const choose = (option) => {
        const value = option.dataset.value;
        close(true);
        if (value !== current) assign(ticketId, value, current, { undoable: true });
      };

      if (search) {
        search.addEventListener('input', () => {
          const words = search.value.trim().toLowerCase();
          list.querySelectorAll('[role="option"]').forEach((option) => {
            const text = option.dataset.search || option.textContent.toLowerCase();
            option.hidden = words !== '' && !text.includes(words);
          });
          empty.hidden = visible().length > 0;
          activate(visible()[0] || null);
        });
      }
      pop.addEventListener('keydown', (event) => {
        const options = visible();
        const index = options.indexOf(active);
        if (event.key === 'ArrowDown') { event.preventDefault(); activate(options[Math.min(index + 1, options.length - 1)] || null); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); activate(options[Math.max(index - 1, 0)] || null); }
        else if (event.key === 'Home' && !search) { event.preventDefault(); activate(options[0] || null); }
        else if (event.key === 'End' && !search) { event.preventDefault(); activate(options[options.length - 1] || null); }
        else if (event.key === 'Enter') { event.preventDefault(); if (active) choose(active); }
        else if (event.key === 'Escape') { event.preventDefault(); close(true); }
        else if (event.key === 'Tab') { close(false); }
      });
      list.addEventListener('click', (event) => {
        const option = event.target.closest('[role="option"]');
        if (option) choose(option);
      });
      list.addEventListener('pointermove', (event) => {
        const option = event.target.closest('[role="option"]');
        if (option && option !== active) activate(option);
      });

      open = { button, pop };
      position(button, pop);
      document.addEventListener('pointerdown', onOutside, true);
      document.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', onResize);
      focusTarget.focus();
      activate(list.querySelector('[aria-selected="true"]') || visible()[0] || null);
    };

    root.addEventListener('click', (event) => {
      const button = event.target.closest('[data-support-assign]');
      if (!button || !root.contains(button)) return;
      event.preventDefault();
      if (open && open.button === button) close(true);
      else openPicker(button);
    });
    root.addEventListener('keydown', (event) => {
      const button = event.target.closest && event.target.closest('[data-support-assign]');
      if (!button) return;
      if (event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault();
        openPicker(button);
      }
    });
  }

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
