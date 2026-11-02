// Ticket composer (05 §3): reply/note switch, saved replies, attachments,
// sending state, Ctrl/⌘+Enter and the unsaved-draft warning.
// Files are read in the browser and posted as base64 (decision-9: outbound
// attachments, option A), capped at 10 MB in total.
(function () {
  const form = document.querySelector('[data-support-composer]');
  if (!form) return;

  const MAX_BYTES = 10 * 1024 * 1024;
  const body = form.querySelector('textarea[name="body"]');
  const replyOnly = form.querySelectorAll('[data-support-reply-only]');
  const send = form.querySelector('[data-support-send]');
  const sendLabel = form.querySelector('[data-support-send-label]');
  let reading = Promise.resolve();
  let submitting = false;

  const syncMode = () => {
    const note = form.querySelector('input[name="mode"]:checked').value === 'note';
    form.classList.toggle('pos-support-composer-note', note);
    replyOnly.forEach((el) => { el.hidden = note; });
    if (sendLabel && !submitting) sendLabel.textContent = note ? form.dataset.noteLabel : form.dataset.sendLabel;
  };
  form.querySelectorAll('input[name="mode"]').forEach((input) => input.addEventListener('change', syncMode));
  syncMode();

  const saved = form.querySelector('[data-support-saved]');
  if (saved) {
    saved.addEventListener('change', () => {
      const option = saved.selectedOptions[0];
      if (option && option.dataset.text) {
        body.value = body.value ? body.value + '\n\n' + option.dataset.text : option.dataset.text;
        body.focus();
      }
      saved.value = '';
    });
  }

  const files = form.querySelector('[data-support-files]');
  const holder = form.querySelector('[data-support-files-fields]');
  const list = form.querySelector('[data-support-files-list]');
  const readFile = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const hidden = (name, value) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    return input;
  };
  // keep in step with lib/helpers/filesize.liquid, which labels the same
  // files once they are on the ticket
  const filesize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    const wholeKb = Math.round(kb);
    if (wholeKb < 1024) return `${wholeKb} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  };
  const chip = (file) => {
    const item = document.createElement('span');
    item.className = 'pos-support-chip';
    item.textContent = `${file.name} · ${filesize(file.size)}`;
    return item;
  };

  if (files) {
    files.addEventListener('change', () => {
      holder.textContent = '';
      if (list) list.textContent = '';
      const chosen = Array.from(files.files);
      const total = chosen.reduce((sum, file) => sum + file.size, 0);
      if (total > MAX_BYTES) {
        files.value = '';
        files.setCustomValidity(form.dataset.tooLarge || 'Attachments are limited to 10 MB in total.');
        files.reportValidity();
        return;
      }
      files.setCustomValidity('');
      reading = (async () => {
        for (const file of chosen) {
          const content = await readFile(file);
          holder.append(hidden('attachments[][filename]', file.name));
          holder.append(hidden('attachments[][content_type]', file.type || 'application/octet-stream'));
          holder.append(hidden('attachments[][content_base64]', content));
          if (list) list.append(chip(file));
        }
      })();
    });
  }

  // one submission only; wait until the attachments are read
  form.addEventListener('submit', async (event) => {
    if (submitting) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    submitting = true;
    send.setAttribute('aria-busy', 'true');
    send.disabled = true;
    if (sendLabel) sendLabel.textContent = form.dataset.preparing || sendLabel.textContent;
    try {
      await reading;
    } catch (error) {
      // a file that cannot be read is skipped; the message still goes out
    }
    if (sendLabel) sendLabel.textContent = form.dataset.sending || sendLabel.textContent;
    window.removeEventListener('beforeunload', warn);
    HTMLFormElement.prototype.submit.call(form);
  });

  body.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      form.requestSubmit(send);
    }
  });

  const warn = (event) => {
    if (body.value.trim() === '') return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', warn);
})();
