// Desk-wide behaviour: confirmation before destructive actions
// (data-support-confirm on a button or form) and the mobile navigation drawer.
(function () {
  document.addEventListener('submit', (event) => {
    const button = event.submitter;
    const message = (button && button.dataset.supportConfirm) || event.target.dataset.supportConfirm;
    if (!message) return;
    const count = event.target.querySelectorAll('.pos-support-select:checked').length;
    if (!window.confirm(message.replace('%{count}', count))) event.preventDefault();
  });

  // forms that wait on a slow call (data-support-pending="Working…") show it on
  // the button and cannot be sent twice
  document.addEventListener('submit', (event) => {
    const form = event.target;
    const pending = form.dataset && form.dataset.supportPending;
    if (!pending || event.defaultPrevented) return;
    const button = event.submitter || form.querySelector('button[type="submit"], button:not([type])');
    form.querySelectorAll('button').forEach((b) => { b.setAttribute('aria-busy', 'true'); });
    if (button) button.textContent = pending;
    // disabled after the submission has started, so the clicked button's value is still sent
    setTimeout(() => form.querySelectorAll('button').forEach((b) => { b.disabled = true; }), 0);
  });

  // ticket page: j / k open the next / previous ticket of the queue it came from
  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const link = event.key === 'j' ? document.querySelector('[data-support-next]') : event.key === 'k' ? document.querySelector('[data-support-prev]') : null;
    if (link) link.click();
  });

  // ticket properties save as soon as a choice changes; with a reply draft
  // open they save in the background so the draft is kept
  // Ticket properties save as soon as a control changes, without leaving the
  // page: the answer is JSON with the new badges, and the toast reports the
  // save itself. The Save button (tags, or no JavaScript) goes the same way.
  const swapBadge = (selector, html) => {
    const current = document.querySelector(selector);
    if (!current || !html) return;
    const template = document.createElement('template');
    template.innerHTML = html;
    if (template.content.firstElementChild) current.replaceWith(template.content.firstElementChild);
  };
  document.querySelectorAll('[data-support-autosave]').forEach((form) => {
    const save = async () => {
      const data = new FormData(form);
      data.set('respond', 'json');
      let body = null;
      try {
        const response = await fetch(form.action, { method: 'POST', body: data, credentials: 'same-origin' });
        body = await response.json();
      } catch (error) {
        body = null;
      }
      if (body && body.ok && body.reload) {
        window.location.reload();
        return;
      }
      if (body && body.ok) {
        swapBadge('.pos-support-ticket-title .pos-support-priority', body.priority_html);
        swapBadge('.pos-support-ticket-badges .pos-support-status', body.status_html);
      }
      if (window.pos && window.pos.modules && window.pos.modules.toast) {
        const ok = body && body.ok;
        new window.pos.modules.toast(ok ? 'success' : 'error', (body && body.message) || form.dataset.failed);
      }
    };
    form.addEventListener('change', (event) => {
      if (event.target.matches('select, input[type="radio"]')) save();
    });
    form.addEventListener('submit', (event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      save();
    });
  });

  // typing into a field that only applies with a box unticked unticks it
  // (data-support-untick="<checkbox id>"), e.g. branding overrides vs host branding
  document.addEventListener('input', (event) => {
    const id = event.target.dataset && event.target.dataset.supportUntick;
    const box = id && document.getElementById(id);
    if (box && event.target.value.trim() !== '') box.checked = false;
  });

  const toggle = document.querySelector('[data-support-nav-toggle]');
  if (!toggle) return;
  const rail = document.getElementById('pos-support-rail');
  const sync = () => toggle.setAttribute('aria-expanded', toggle.checked ? 'true' : 'false');
  sync();
  toggle.addEventListener('change', () => {
    sync();
    if (toggle.checked && rail) {
      const first = rail.querySelector('a');
      if (first) first.focus();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toggle.checked) {
      toggle.checked = false;
      sync();
      toggle.focus();
    }
  });
})();
