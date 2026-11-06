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
  // the choices last saved, so a refused change puts the controls back
  const snapshot = (form) => Array.from(form.querySelectorAll('select, input[type="radio"]')).map((el) => [el, el.type === 'radio' ? el.checked : el.value]);
  const restore = (saved) => saved.forEach(([el, value]) => { if (el.type === 'radio') el.checked = value; else el.value = value; });
  document.querySelectorAll('[data-support-autosave]').forEach((form) => {
    let saved = snapshot(form);
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
        // a reply being written survives the reload (restored by pos-support-ticket.js)
        const composer = document.querySelector('[data-support-composer]');
        const draft = composer && composer.querySelector('textarea[name="body"]');
        if (draft && draft.value.trim() !== '') {
          try {
            window.sessionStorage.setItem(`pos-support-draft:${window.location.pathname}`, draft.value);
            composer.dataset.draftKept = 'true';
          } catch (error) { /* storage unavailable: the unsaved-draft warning still asks */ }
        }
        window.location.reload();
        return;
      }
      if (body && body.ok) {
        saved = snapshot(form);
        swapBadge('.pos-support-ticket-title .pos-support-priority', body.priority_html);
        swapBadge('.pos-support-ticket-badges .pos-support-status', body.status_html);
      } else {
        restore(saved);
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

  // the brand logo follows the background it actually sits on: a brand-coloured
  // (dark) rail gets the dark-background logo in either colour scheme. A canvas
  // parses any CSS colour the browser supports (hex, rgb, color-mix, oklch…).
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const backgroundOf = (element) => {
    for (let el = element; el && probe; el = el.parentElement) {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = getComputedStyle(el).backgroundColor;
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
      if (a > 127) return [r, g, b];
    }
    return null;
  };
  const isDark = ([r, g, b]) => {
    const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    // below this luminance white text has more contrast than black
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) < 0.179;
  };
  const pickLogos = () => {
    document.querySelectorAll('img[data-support-logo-dark]').forEach((img) => {
      const rgb = backgroundOf(img.parentElement);
      if (!rgb) return;
      const picture = img.closest('picture');
      if (picture) picture.querySelectorAll('source').forEach((source) => source.remove());
      const src = isDark(rgb) ? img.dataset.supportLogoDark : img.dataset.supportLogoLight;
      if (img.getAttribute('src') !== src) img.setAttribute('src', src);
      img.dataset.supportLogoPicked = isDark(rgb) ? 'dark' : 'light';
    });
  };
  pickLogos();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', pickLogos);

  // default app icon (PRD WL-5, design handoff 3.20): with no icon from the
  // host, an admin's browser draws the module's support icon in its frame (a
  // dark shade of the brand, the icon recoloured to the brand, as in the
  // sidebar) as a 512 px PNG and stores it; redrawn when the brand colour or
  // the icon changes. Drawn from the light look only, so switching the device
  // to dark mode does not redraw it back and forth.
  const probe512 = document.querySelector('[data-support-monogram]');
  const deviceDark = document.documentElement.classList.contains('pos-theme-darkEnabled')
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const frame = probe512 && probe512.querySelector('.pos-support-brand-frame');
  const icon = frame && frame.querySelector('img');
  if (frame && icon && !deviceDark && window.fetch) {
    // the probe is hidden; colours still compute, through a canvas so any CSS colour works
    const solid = (css) => {
      const x = document.createElement('canvas').getContext('2d');
      x.fillStyle = css;
      return x.fillStyle;
    };
    const style = getComputedStyle(frame);
    const shade = solid(style.backgroundColor);
    const brand = solid(style.getPropertyValue('--pos-support-brand').trim());
    const source = ['support-icon', icon.getAttribute('src'), shade, brand].join('|');
    let hash = 5381;
    for (let i = 0; i < source.length; i += 1) hash = ((hash * 33) ^ source.charCodeAt(i)) >>> 0;
    const signature = `icon-${hash.toString(36)}`;
    if (signature !== probe512.dataset.supportMonogramSignature) {
      const image = new Image();
      // the asset CDN is another origin: a CORS image keeps the canvas exportable
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        // full-bleed square: the platforms round or mask the corners themselves
        ctx.fillStyle = shade;
        ctx.fillRect(0, 0, 512, 512);
        const pad = 96;
        const box = 512 - pad * 2;
        const scale = Math.min(box / image.naturalWidth, box / image.naturalHeight);
        const w = image.naturalWidth * scale;
        const h = image.naturalHeight * scale;
        ctx.filter = 'grayscale(1) contrast(1.1)';
        ctx.drawImage(image, (512 - w) / 2, (512 - h) / 2, w, h);
        ctx.filter = 'none';
        ctx.globalCompositeOperation = 'color';
        ctx.fillStyle = brand;
        ctx.fillRect(0, 0, 512, 512);
        ctx.globalCompositeOperation = 'source-over';
        // a browser that still treats the image as foreign refuses to export it: no icon then
        let data;
        try { data = canvas.toDataURL('image/png').split(',')[1]; } catch (e) { return; }
        const body = new FormData();
        body.append('authenticity_token', probe512.dataset.supportMonogramToken);
        body.append('section', 'branding');
        body.append('only', 'monogram');
        body.append('signature', signature);
        body.append('monogram[content_base64]', data);
        body.append('monogram[content_type]', 'image/png');
        body.append('monogram[filename]', 'monogram.png');
        fetch('/support-desk/settings/save', { method: 'POST', body, credentials: 'same-origin', redirect: 'manual' })
          .then(() => { probe512.dataset.supportMonogramSignature = signature; })
          .catch(() => {});
      };
      image.src = icon.getAttribute('src');
    }
  }

  // branding images: a chosen file is read in the browser and posted as base64
  // (decision-9), checked here for size and, for the app icon, a square of at
  // least 512 px; the server checks the type and content again
  document.querySelectorAll('input[type="file"][data-support-brand-file]').forEach((input) => {
    const key = input.dataset.supportBrandFile;
    const form = input.form;
    const holder = form.querySelector(`[data-support-brand-upload="${key}"]`);
    const status = form.querySelector(`[data-support-brand-chosen="${key}"]`);
    const fail = (message) => {
      input.value = '';
      holder.replaceChildren();
      status.textContent = '';
      input.setCustomValidity(message);
      input.reportValidity();
    };
    input.addEventListener('change', () => {
      input.setCustomValidity('');
      holder.replaceChildren();
      status.textContent = '';
      const file = input.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { fail(form.dataset.supportErrorSize); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result);
        const store = () => {
          const add = (name, value) => {
            const field = document.createElement('input');
            field.type = 'hidden';
            field.name = `uploads[${key}][${name}]`;
            field.value = value;
            holder.append(field);
          };
          add('content_base64', url.slice(url.indexOf(',') + 1));
          add('content_type', file.type || 'application/octet-stream');
          add('filename', file.name);
          status.textContent = form.dataset.supportChosen.replace('%{name}', file.name);
          const box = document.getElementById(form.dataset.supportUntickId);
          if (box) box.checked = false;
        };
        if (key !== 'icon_url') { store(); return; }
        const image = new Image();
        image.onload = () => {
          if (image.naturalWidth !== image.naturalHeight || image.naturalWidth < 512) fail(form.dataset.supportErrorSquare);
          else store();
        };
        image.onerror = () => fail(form.dataset.supportErrorSquare);
        image.src = url;
      };
      reader.onerror = () => fail(form.dataset.supportErrorSize);
      reader.readAsDataURL(file);
    });
  });

  // tooltips ([data-tooltip], handoff 3.32): Escape hides the open one until the
  // pointer or focus leaves it, without moving either (WCAG 1.4.13)
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('[data-tooltip]:hover, [data-tooltip]:focus-visible').forEach((el) => el.classList.add('pos-support-tip-off'));
  });
  const tipOn = (event) => {
    const el = event.target.closest && event.target.closest('[data-tooltip].pos-support-tip-off');
    if (el && !el.contains(event.relatedTarget)) el.classList.remove('pos-support-tip-off');
  };
  document.addEventListener('mouseout', tipOn);
  document.addEventListener('focusout', tipOn);

  // Reset all filters disappears after the reload, so focus goes to the search field
  const focusKey = 'pos-support-focus-search';
  const reset = document.querySelector('[data-support-reset-filters]');
  if (reset) reset.addEventListener('click', () => { try { sessionStorage.setItem(focusKey, '1'); } catch (e) { /* private mode */ } });
  try {
    if (sessionStorage.getItem(focusKey)) {
      sessionStorage.removeItem(focusKey);
      const search = document.querySelector('[data-support-search]');
      if (search) search.focus();
    }
  } catch (e) { /* storage unavailable: focus stays where the browser puts it */ }

  // sidebar tooltips (handoff 3.34): name and count of each item to its right,
  // only while the sidebar is collapsed (the collapse button always); position:
  // fixed so the rail's overflow cannot clip it; Escape dismisses (WCAG 1.4.13).
  // Decorative: the items keep their full accessible names.
  let railTip = null;
  const shellForTip = document.querySelector('[data-support-shell]');
  const showRailTip = (el) => {
    if (!shellForTip || window.matchMedia('(max-width: 48rem)').matches) return;
    if (!el.matches('.pos-support-rail-toggle') && !shellForTip.classList.contains('pos-support-rail-collapsed')) return;
    if (!railTip) {
      railTip = document.createElement('div');
      railTip.className = 'pos-support-rail-tip';
      railTip.setAttribute('aria-hidden', 'true');
      railTip.hidden = true;
      document.body.append(railTip);
    }
    const box = el.getBoundingClientRect();
    railTip.textContent = el.dataset.supportTip;
    railTip.style.left = `${Math.round(box.right + 8)}px`;
    railTip.style.top = `${Math.round(box.top + box.height / 2)}px`;
    railTip.hidden = false;
  };
  const hideRailTip = () => { if (railTip) railTip.hidden = true; };
  document.querySelectorAll('.pos-support-rail [data-support-tip]').forEach((el) => {
    el.addEventListener('mouseenter', () => showRailTip(el));
    el.addEventListener('mouseleave', hideRailTip);
    el.addEventListener('focus', () => { if (el.matches(':focus-visible')) showRailTip(el); });
    el.addEventListener('blur', hideRailTip);
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hideRailTip(); });

  // desktop sidebar collapse (design review F): toggled at once, remembered
  // through a background post; without JavaScript the form posts and reloads
  const railForm = document.querySelector('[data-support-rail-toggle]');
  const shell = document.querySelector('[data-support-shell]');
  if (railForm && shell && window.fetch) {
    railForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const collapse = !shell.classList.contains('pos-support-rail-collapsed');
      shell.classList.toggle('pos-support-rail-collapsed', collapse);
      const button = railForm.querySelector('button');
      const label = collapse ? railForm.dataset.labelExpand : railForm.dataset.labelCollapse;
      button.setAttribute('aria-expanded', collapse ? 'false' : 'true');
      button.setAttribute('aria-label', label);
      button.dataset.supportTip = label;
      if (railTip && !railTip.hidden) railTip.textContent = label;
      const body = new FormData(railForm);
      body.set('rail', collapse ? 'collapsed' : 'expanded');
      body.set('respond', 'json');
      railForm.querySelector('[name="rail"]').value = collapse ? 'expanded' : 'collapsed';
      fetch(railForm.action, { method: 'POST', body, credentials: 'same-origin' }).catch(() => {});
    });
  }

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
