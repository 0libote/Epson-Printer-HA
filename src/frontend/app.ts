// Bun 1.4 frontend - TypeScript port of app/static/app.js with strict types
document.querySelectorAll<HTMLInputElement>('[data-file-input]').forEach(input => {
  const error = document.getElementById('file-inline-error') as HTMLElement | null;
  const maxMb = Number.parseFloat(input.dataset.maxMb || '128');
  const maxBytes = maxMb * 1024 * 1024;
  const validate = () => {
    const label = input.closest('label')?.querySelector('[data-file-label]') as HTMLElement | null;
    const file = input.files?.[0];
    if (label) label.textContent = file?.name || 'Choose a file';
    if (!file) {
      if (error) { error.hidden = true; error.textContent = ''; }
      input.setCustomValidity('');
      return;
    }
    const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
    const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.txt'];
    if (!allowed.includes(ext)) {
      const msg = 'Supported files: PDF, PNG, JPG and TXT.';
      if (error) { error.textContent = msg; error.hidden = false; }
      input.setCustomValidity(msg);
    } else if (file.size > maxBytes) {
      const msg = `That file is too large. The limit is ${maxMb} MB.`;
      if (error) { error.textContent = msg; error.hidden = false; }
      input.setCustomValidity(msg);
    } else if (file.size === 0) {
      const msg = 'The selected file is empty.';
      if (error) { error.textContent = msg; error.hidden = false; }
      input.setCustomValidity(msg);
    } else {
      if (error) { error.hidden = true; error.textContent = ''; }
      input.setCustomValidity('');
    }
    if ((input as any).reportValidity) (input as any).reportValidity();
  };
  input.addEventListener('change', validate);
});

const busyTimers = new WeakMap<HTMLFormElement, number>();

document.querySelectorAll<HTMLFormElement>('[data-busy-form]').forEach(form => {
  form.addEventListener('submit', event => {
    if ((form.dataset.submitting as string) === 'true') {
      event.preventDefault();
      return;
    }
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!button) return;
    form.dataset.submitting = 'true';
    form.setAttribute('aria-busy', 'true');
    (button.dataset as any).idleText = button.textContent || "";
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
    const statusAnchor = (button.closest('.field-action') as HTMLElement) || button;
    statusAnchor.insertAdjacentElement('afterend', status);
    const stage = status.querySelector('[data-operation-stage]') as HTMLElement;
    const elapsed = status.querySelector('[data-operation-time]') as HTMLElement;
    const startedAt = Date.now();
    const updateStatus = () => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      const stageIndex = Math.min(Math.floor(elapsedSeconds / stageSeconds), stages.length - 1);
      if (stage) stage.textContent = stages[stageIndex] || "";
      if (!elapsed) return;
      if (elapsedSeconds < 1) elapsed.textContent = 'Just started';
      else if (elapsedSeconds < 60) elapsed.textContent = `${elapsedSeconds}s elapsed`;
      else {
        const minutes = Math.floor(elapsedSeconds / 60);
        const seconds = elapsedSeconds % 60;
        elapsed.textContent = `${minutes}m ${String(seconds).padStart(2, '0')}s elapsed`;
      }
    };
    updateStatus();
    busyTimers.set(form, window.setInterval(updateStatus, 1000));
  });
});

window.addEventListener('pageshow', event => {
  if (!(event as PageTransitionEvent).persisted) return;
  document.querySelectorAll<HTMLFormElement>('[data-busy-form]').forEach(form => {
    const t = busyTimers.get(form);
    if (t) window.clearInterval(t);
    busyTimers.delete(form);
    delete (form.dataset as any).submitting;
    form.removeAttribute('aria-busy');
    form.querySelector('.operation-status')?.remove();
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (button?.dataset.idleText) button.textContent = button.dataset.idleText;
    if (button) button.disabled = false;
  });
});

document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach(button => {
  button.addEventListener('click', async () => {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(button.dataset.copy || "");
    } else {
      const input = document.createElement('textarea');
      input.value = button.dataset.copy || "";
      document.body.append(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    button.textContent = 'Copied';
    setTimeout(() => button.textContent = 'Copy', 1500);
  });
});

// live polling
(() => {
  const pollInterval = Number.parseInt((document.body.dataset.pollInterval as string) || '3000', 10);
  if (!(document.body.dataset.printerIp as string)) return;
  const $ = (id: string) => document.getElementById(id);
  const healthBadge = $('health-badge'), healthText = $('health-text');
  const summaryPrinterDot = $('summary-printer-dot'), summaryPrinterText = $('summary-printer-text');
  const summaryScannerDot = $('summary-scanner-dot'), summaryScannerText = $('summary-scanner-text');
  const statusPrinterDot = $('status-printer-dot'), statusPrinterText = $('status-printer-text');
  const statusScannerDot = $('status-scanner-dot'), statusScannerText = $('status-scanner-text'), statusScannerDetail = $('status-scanner-detail');
  const statusQueueDot = $('status-queue-dot'), statusQueueText = $('status-queue-text'), statusQueueDetail = $('status-queue-detail');
  const liveDot = $('live-dot'), liveText = $('live-text'), liveTime = $('live-time');
  const queuePanel = $('queue-panel'), queueList = $('queue-list'), activityGrid = $('activity-grid');
  const scansPanel = $('scans-panel'), scansList = $('scans-list');
  const historyTbody = $('history-tbody'), historySummary = $('history-summary'), historyWrap = $('history-wrap'), historyEmpty = $('history-empty');
  const setDot = (el: HTMLElement | null, cls: string) => {
    if (!el) return;
    el.classList.remove('good', 'warn', 'bad');
    if (cls) el.classList.add(cls);
  };
  const title = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  let lastQueue: string | null = null, lastHistory: string | null = null;
  let consecutiveErrors = 0;
  async function poll() {
    try {
      const res = await fetch('/api/status', { credentials: 'same-origin', headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error('status ' + res.status);
      const data: any = await res.json();
      consecutiveErrors = 0;
      if (healthBadge && healthText) {
        const online = !!data.reachable;
        healthBadge.classList.toggle('online', online);
        healthBadge.classList.toggle('offline', !online);
        healthText.textContent = online ? 'Online' : 'Needs attention';
      }
      const pState = (data.printer && data.printer.state) || 'unknown';
      const pOk = !!(data.printer && data.printer.ok);
      if (summaryPrinterText) summaryPrinterText.textContent = 'Printer ' + String(pState).replace('_', ' ');
      if (statusPrinterText) statusPrinterText.textContent = title(String(pState).replace('_', ' '));
      setDot(summaryPrinterDot, pOk ? 'good' : 'bad');
      setDot(statusPrinterDot, pOk ? 'good' : 'bad');
      const sOk = !!(data.scanner && data.scanner.ok);
      const sState = sOk ? 'ready' : 'unavailable';
      const sDetail = data.scanner && (data.scanner.backend || data.scanner.detail) || '';
      if (summaryScannerText) summaryScannerText.textContent = 'Scanner ' + sState;
      if (statusScannerText) statusScannerText.textContent = sOk ? 'Ready' : 'Starting';
      if (statusScannerDetail) statusScannerDetail.textContent = sDetail || (sOk ? 'Ready' : 'Automatic setup in progress');
      setDot(summaryScannerDot, sOk ? 'good' : 'warn');
      setDot(statusScannerDot, sOk ? 'good' : 'warn');
      const queue: any[] = Array.isArray(data.queue) ? data.queue : [];
      const qCount = queue.length;
      if (statusQueueText) statusQueueText.textContent = qCount + ' ' + (qCount === 1 ? 'job' : 'jobs');
      if (statusQueueDetail) statusQueueDetail.textContent = qCount ? 'Working through the queue' : 'Nothing waiting';
      if (statusQueueDot) setDot(statusQueueDot, qCount ? 'warn' : 'good');
      if (queueList) {
        const qJson = JSON.stringify(queue);
        if (qJson !== lastQueue) {
          lastQueue = qJson;
          queueList.innerHTML = '';
          queue.forEach((job: any) => {
            const row = document.createElement('div');
            row.className = 'item-row';
            const left = document.createElement('span');
            const strong = document.createElement('strong');
            strong.textContent = job.id;
            const small = document.createElement('small');
            small.textContent = (job.owner || '') + ' · ' + (job.size || '');
            left.append(strong, small);
            const form = document.createElement('form');
            form.method = 'post';
            form.action = '/jobs/' + encodeURIComponent(job.id) + '/cancel';
            const csrf = (document.querySelector('input[name="_csrf_token"]') as HTMLInputElement)?.value || '';
            form.innerHTML = `<input type="hidden" name="_csrf_token" value="${csrf.replace(/"/g, '&quot;')}"><button class="button-quiet danger" type="submit">Cancel</button>`;
            row.append(left, form);
            queueList.appendChild(row);
          });
          if (queuePanel) (queuePanel as HTMLElement).hidden = qCount === 0;
          if (activityGrid) {
            const scansVisible = scansPanel && !(scansPanel as HTMLElement).hidden;
            (activityGrid as HTMLElement).hidden = qCount === 0 && !scansVisible;
          }
        }
      }
      if (scansList) {
        const scans: string[] = Array.isArray(data.scans) ? data.scans : [];
        const sJson = JSON.stringify(scans);
        if (sJson !== ((scansList as HTMLElement).dataset.last || '')) {
          (scansList as HTMLElement).dataset.last = sJson;
          scansList.innerHTML = '';
          scans.forEach(name => {
            const a = document.createElement('a');
            a.className = 'item-row';
            a.href = '/scans/' + encodeURIComponent(name);
            const left = document.createElement('span');
            const strong = document.createElement('strong');
            strong.textContent = name;
            const small = document.createElement('small');
            small.textContent = 'Saved scan';
            left.append(strong, small);
            const dl = document.createElement('span');
            dl.className = 'download';
            dl.textContent = 'Download';
            a.append(left, dl);
            scansList.appendChild(a);
          });
          if (scansPanel) (scansPanel as HTMLElement).hidden = scans.length === 0;
          if (activityGrid) {
            const qVisible = queuePanel && !(queuePanel as HTMLElement).hidden;
            (activityGrid as HTMLElement).hidden = scans.length === 0 && !qVisible;
          }
        }
      }
      try {
        if (historyTbody) {
          const hRes = await fetch('/api/history?limit=100', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
          if (hRes.ok) {
            const hData: any = await hRes.json();
            const prints: any[] = Array.isArray(hData.history) ? hData.history : [];
            const hJson = JSON.stringify(prints.map((p: any) => (p as any).history_key || p.job_id + ':' + p.created_at + ':' + p.state));
            if (hJson !== lastHistory) {
              lastHistory = hJson;
              if (historySummary) historySummary.textContent = prints.length + ' recent ' + (prints.length === 1 ? 'job' : 'jobs') + ' · file contents are not stored';
              historyTbody.innerHTML = '';
              if (prints.length) {
                prints.forEach((job: any) => {
                  const tr = document.createElement('tr');
                  const docTd = document.createElement('td');
                  docTd.setAttribute('data-label', 'Document');
                  const strong = document.createElement('strong');
                  strong.textContent = job.document || 'Untitled job';
                  const small = document.createElement('small');
                  small.textContent = '#' + job.job_id;
                  docTd.append(strong, small);
                  const whenTd = document.createElement('td');
                  whenTd.setAttribute('data-label', 'When');
                  whenTd.textContent = job.created_display || '';
                  const fromTd = document.createElement('td');
                  fromTd.setAttribute('data-label', 'From');
                  fromTd.textContent = job.origin_host || job.user_name || job.source || '';
                  const statusTd = document.createElement('td');
                  statusTd.setAttribute('data-label', 'Status');
                  const span = document.createElement('span');
                  span.className = 'job-state state-' + (job.state || 'unknown');
                  span.textContent = title((job.state || 'unknown').replace('_', ' '));
                  statusTd.appendChild(span);
                  const sizeTd = document.createElement('td');
                  sizeTd.setAttribute('data-label', 'Size');
                  sizeTd.textContent = job.size_display || '';
                  tr.append(docTd, whenTd, fromTd, statusTd, sizeTd);
                  historyTbody.appendChild(tr);
                });
                if (historyWrap) (historyWrap as HTMLElement).hidden = false;
                if (historyEmpty) (historyEmpty as HTMLElement).hidden = true;
              } else {
                if (historyWrap) (historyWrap as HTMLElement).hidden = true;
                if (historyEmpty) (historyEmpty as HTMLElement).hidden = false;
              }
            }
          }
        } else if (historySummary) {
          const prints: any[] = Array.isArray(data.recent_prints) ? data.recent_prints : [];
          historySummary.textContent = prints.length + ' recent ' + (prints.length === 1 ? 'job' : 'jobs') + ' · file contents are not stored';
        }
      } catch (_) {}
      if (liveDot) liveDot.className = 'live-dot live-dot--ok';
      if (liveText) liveText.textContent = 'Live';
      if (liveTime) liveTime.textContent = 'updated ' + new Date().toLocaleTimeString();
    } catch (e) {
      consecutiveErrors++;
      if (liveDot) liveDot.className = 'live-dot live-dot--error';
      if (liveText) liveText.textContent = consecutiveErrors > 2 ? 'Offline' : 'Retrying';
    }
  }
  setTimeout(poll, 800);
  let timer = setInterval(poll, pollInterval) as unknown as number;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearInterval(timer);
    else { poll(); timer = setInterval(poll, pollInterval) as unknown as number; }
  });
})();
