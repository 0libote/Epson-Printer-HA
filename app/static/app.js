document.querySelectorAll('[data-file-input]').forEach(input => {
  input.addEventListener('change', () => {
    const label = input.closest('label').querySelector('[data-file-label]');
    label.textContent = input.files[0]?.name || 'Choose a file';
  });
});

document.querySelectorAll('[data-busy-form]').forEach(form => {
  form.addEventListener('submit', () => {
    const button = form.querySelector('button[type="submit"]');
    if (!button) return;
    button.disabled = true;
    button.textContent = button.dataset.busyText || 'Working…';
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
