// Filter dropdowns with markers (design review E): each <select data-support-rich-select>
// becomes a select-only combobox (WAI-ARIA APG pattern). Focus stays on the
// combobox; the open listbox's active option is announced through
// aria-activedescendant. The markers (priority chips, department tags,
// avatars, status chips) are rendered by the server in the hidden
// [data-support-options-for] block next to the select, so no colours or
// labels live here. The select stays in the form: picking an option sets its
// value and fires "change", so the queue's auto-submit works as before.
// Without JavaScript the plain select is used.
(function () {
  let uid = 0;

  const enhance = (select) => {
    const markers = document.querySelector(`[data-support-options-for="${select.id}"]`);
    const label = document.getElementById(`${select.id}-label`);
    const markerFor = (value) => (markers ? markers.querySelector(`[data-value="${CSS.escape(value)}"]`) : null);
    const contentOf = (option) => {
      const marker = option.value === '' ? null : markerFor(option.value);
      const span = document.createElement('span');
      span.className = 'pos-support-richselect-content';
      if (marker) span.innerHTML = marker.innerHTML;
      else span.textContent = option.text;
      return span;
    };

    uid += 1;
    const id = `pos-support-richselect-${uid}`;
    const wrap = document.createElement('div');
    wrap.className = 'pos-support-richselect';
    const box = document.createElement('div');
    box.className = 'pos-support-richselect-box';
    box.id = `${id}-box`;
    box.tabIndex = 0;
    box.setAttribute('role', 'combobox');
    box.setAttribute('aria-haspopup', 'listbox');
    box.setAttribute('aria-expanded', 'false');
    box.setAttribute('aria-controls', `${id}-list`);
    if (label) box.setAttribute('aria-labelledby', `${label.id} ${box.id}`);
    const list = document.createElement('ul');
    list.className = 'pos-support-richselect-list';
    list.id = `${id}-list`;
    list.setAttribute('role', 'listbox');
    list.tabIndex = -1;
    if (label) list.setAttribute('aria-labelledby', label.id);
    list.hidden = true;

    const options = Array.from(select.options).map((option, index) => {
      const li = document.createElement('li');
      li.id = `${id}-opt-${index}`;
      li.setAttribute('role', 'option');
      li.dataset.value = option.value;
      li.append(contentOf(option));
      list.append(li);
      return li;
    });

    let active = Math.max(0, select.selectedIndex);
    const render = () => {
      box.replaceChildren(contentOf(select.options[select.selectedIndex] || select.options[0]));
      box.classList.toggle('pos-support-richselect-set', select.value !== '');
      options.forEach((li, i) => li.setAttribute('aria-selected', i === select.selectedIndex ? 'true' : 'false'));
    };
    const setActive = (index) => {
      active = Math.max(0, Math.min(options.length - 1, index));
      options.forEach((li, i) => li.classList.toggle('pos-support-richselect-active', i === active));
      box.setAttribute('aria-activedescendant', options[active].id);
      options[active].scrollIntoView({ block: 'nearest' });
    };
    const isOpen = () => box.getAttribute('aria-expanded') === 'true';
    const open = () => {
      if (isOpen()) return;
      list.hidden = false;
      box.setAttribute('aria-expanded', 'true');
      setActive(Math.max(0, select.selectedIndex));
    };
    const close = () => {
      list.hidden = true;
      box.setAttribute('aria-expanded', 'false');
      box.removeAttribute('aria-activedescendant');
    };
    const choose = (index) => {
      close();
      if (select.selectedIndex === index) return;
      select.selectedIndex = index;
      render();
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };

    let typed = '';
    let typedAt = 0;
    const typeAhead = (key) => {
      const now = Date.now();
      typed = now - typedAt > 600 ? key : typed + key;
      typedAt = now;
      const start = isOpen() ? active + 1 : select.selectedIndex + 1;
      const order = options.map((_, i) => (start + i) % options.length);
      const hit = order.find((i) => options[i].textContent.trim().toLowerCase().startsWith(typed.toLowerCase()));
      if (hit === undefined) return;
      if (isOpen()) setActive(hit);
      else choose(hit);
    };

    box.addEventListener('click', () => (isOpen() ? close() : open()));
    box.addEventListener('keydown', (event) => {
      const key = event.key;
      if (!isOpen()) {
        if (['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Home', 'End'].includes(key)) {
          event.preventDefault();
          open();
          if (key === 'Home') setActive(0);
          if (key === 'End') setActive(options.length - 1);
        } else if (key.length === 1 && /\S/.test(key)) {
          typeAhead(key);
        }
        return;
      }
      switch (key) {
        case 'ArrowDown': event.preventDefault(); setActive(active + 1); break;
        case 'ArrowUp': event.preventDefault(); setActive(active - 1); break;
        case 'Home': event.preventDefault(); setActive(0); break;
        case 'End': event.preventDefault(); setActive(options.length - 1); break;
        case 'PageDown': event.preventDefault(); setActive(active + 10); break;
        case 'PageUp': event.preventDefault(); setActive(active - 10); break;
        case 'Enter':
        case ' ': event.preventDefault(); choose(active); break;
        case 'Escape': event.preventDefault(); close(); break;
        case 'Tab': choose(active); break;
        default:
          if (key.length === 1 && /\S/.test(key)) typeAhead(key);
      }
    });
    list.addEventListener('mousedown', (event) => event.preventDefault());
    list.addEventListener('click', (event) => {
      const li = event.target.closest('[role="option"]');
      if (li) choose(options.indexOf(li));
      box.focus();
    });
    list.addEventListener('mousemove', (event) => {
      const li = event.target.closest('[role="option"]');
      if (li) setActive(options.indexOf(li));
    });
    box.addEventListener('blur', () => { if (isOpen()) close(); });

    select.hidden = true;
    select.tabIndex = -1;
    select.after(wrap);
    wrap.append(box, list);
    render();
  };

  document.querySelectorAll('select[data-support-rich-select]').forEach(enhance);
})();
