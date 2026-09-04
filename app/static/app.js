document.querySelectorAll('[data-file-input]').forEach(input => {
  input.addEventListener('change', () => {
    const label = input.closest('label').querySelector('[data-file-label]');
    label.textContent = input.files[0]?.name || 'Choose a file';
  });
});

const busyTimers = new WeakMap();

document.querySelectorAll('[data-busy-form]').forEach(form => {
  form.addEventListener('submit', event => {
    if (form.dataset.submitting === 'true') {
      event.preventDefault();
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    if (!button) return;

    form.dataset.submitting = 'true';
    form.setAttribute('aria-busy', 'true');
    button.dataset.idleText = button.textContent;
    button.disabled = true;
    button.textContent = button.dataset.busyText || 'Working…';

    const stages = (form.dataset.busyStages || 'Working').split('|');
    const stageSeconds = Number.parseInt(form.dataset.busyStageSeconds || '10', 10);
    const status = document.createElement('div');
    status.className = 'operation-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.innerHTML = `
      <div class="operation-progress" role="progressbar" aria-label="Operation in progress">
        <span></span>
      </div>
      <div class="operation-copy">
        <strong data-operation-stage></strong>
        <span data-operation-time aria-hidden="true">Just started</span>
      </div>`;
    const statusAnchor = button.closest('.field-action') || button;
    statusAnchor.insertAdjacentElement('afterend', status);

    const stage = status.querySelector('[data-operation-stage]');
    const elapsed = status.querySelector('[data-operation-time]');
    const startedAt = Date.now();

    const updateStatus = () => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      const stageIndex = Math.min(Math.floor(elapsedSeconds / stageSeconds), stages.length - 1);
      stage.textContent = stages[stageIndex];
      if (elapsedSeconds < 1) {
        elapsed.textContent = 'Just started';
      } else if (elapsedSeconds < 60) {
        elapsed.textContent = `${elapsedSeconds}s elapsed`;
      } else {
        const minutes = Math.floor(elapsedSeconds / 60);
        const seconds = elapsedSeconds % 60;
        elapsed.textContent = `${minutes}m ${seconds.toString().padStart(2, '0')}s elapsed`;
      }
    };

    updateStatus();
    busyTimers.set(form, window.setInterval(updateStatus, 1000));
  });
});

window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  document.querySelectorAll('[data-busy-form]').forEach(form => {
    window.clearInterval(busyTimers.get(form));
    busyTimers.delete(form);
    delete form.dataset.submitting;
    form.removeAttribute('aria-busy');
    form.querySelector('.operation-status')?.remove();
    const button = form.querySelector('button[type="submit"]');
    if (button?.dataset.idleText) button.textContent = button.dataset.idleText;
    if (button) button.disabled = false;
  });
});

document.querySelectorAll('[data-copy]').forEach(button => {
  button.addEventListener('click', async () => {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(button.dataset.copy);
    } else {
      const input = document.createElement('textarea');
      input.value = button.dataset.copy;
      document.body.append(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    button.textContent = 'Copied';
    setTimeout(() => button.textContent = 'Copy', 1500);
  });
});
