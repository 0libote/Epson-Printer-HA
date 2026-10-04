import { cachedPrinterReachable, cachedCupsPrinterStatus, cachedListJobs, scannerStatus } from "../core.ts";
import { listPrintHistory } from "../history.ts";
import { getCachedInkLevels } from "../ink.ts";
type ViewDependencies = {
 currentPrinterIp: () => string; currentPrinterName: () => string; currentDisplayName: () => string;
 networkSharingEnabledSync: () => boolean; recentScans: (n: number) => Array<{ name: string; path: string }>;
 clientSetup: (name: string, host: string) => any; getCsrfToken: (c: any) => string;
 consumeFlash: (c: any) => Array<{ category: string; message: string }>; escapeHtml: (s: string) => string;
 MAX_UPLOAD_MB: number;
};
export async function renderIndex(c:any, deps: ViewDependencies):Promise<string>{
  const { currentPrinterIp, currentPrinterName, currentDisplayName, networkSharingEnabledSync, recentScans, clientSetup, getCsrfToken, consumeFlash, escapeHtml, MAX_UPLOAD_MB } = deps;
  const printerIp=currentPrinterIp();
  const printerName=currentPrinterName();
  const displayName=currentDisplayName();
  const sharePrinter=networkSharingEnabledSync();
  const hostHeader=c.req.header("host")||"localhost:8080";
  const clientSetupData=clientSetup(printerName, hostHeader);
  let reachable=false;
  let printer:any={ok:false, state:"setup_required", detail:"Add the printer IP below"};
  let scanner:any={ok:false, state:"setup_required", detail:"Add the printer IP below"};
  let jobs:any[]=[];
  let history:any[]=[];
  let scans:Array<{name:string}>=[];
  if(printerIp){
    reachable=await cachedPrinterReachable(printerIp);
    printer=await cachedCupsPrinterStatus(printerName);
    scanner=await scannerStatus(printerIp);
    jobs=await cachedListJobs(printerName);
    try{history=listPrintHistory(100);}catch{}
    scans=recentScans(10).map(s=>({name:s.name}));
  } else { try{history=listPrintHistory(100);}catch{} }
  const ink = printerIp ? getCachedInkLevels(printerIp) : null;
  const inkHtml = printerIp ? `
      <section class="panel" id="ink-panel" aria-label="Ink levels">
        <div class="section-heading"><div><p class="kicker">Supplies</p><h2>Ink levels${ink ? ` · via ${escapeHtml(ink.source.toUpperCase())}` : ""}</h2></div></div>
        ${ink?.cartridges?.length ? `<div class="item-list" id="ink-list">` + ink.cartridges.map((ct: any) => `
          <div class="item-row">
            <span><strong>${escapeHtml(ct.name)}</strong><small>${ct.level == null ? "unknown" : `${ct.level}% · ${escapeHtml(ct.state)}`}</small></span>
            <span class="download">${ct.level == null ? "—" : `${ct.level}%`}</span>
          </div>`).join("") + `</div>`
        : `<p class="empty-copy">Checking printer supplies… fresh levels appear here automatically (also at <code>/api/ink</code>).</p>`}
      </section>` : "";
  const flashes=consumeFlash(c);
  const csrf=getCsrfToken(c);
  const flashHtml=flashes.map(f=>`<div class="notice ${escapeHtml(f.category)}" role="status"><span class="notice-icon" aria-hidden="true">${f.category==="success"?"✓":"!"}</span><span>${escapeHtml(f.message)}</span></div>`).join("");
  const healthBadge=printerIp?`<span class="health ${reachable?"online":"offline"}" id="health-badge" data-reachable="${reachable?"1":"0"}"><span class="health-dot"></span><span id="health-text">${reachable?"Online":"Needs attention"}</span></span>`:`<span class="health setup"><span class="health-dot"></span>Setup needed</span>`;
  const welcomeOrMain=!printerIp?`<section class="welcome panel">
        <div class="welcome-copy">
          <span class="step">One-time setup</span>
          <h1>Connect your printer</h1>
          <p>Enter the IP address shown in your router or on the printer's network status sheet. After this, everyone at home can print from this page.</p>
        </div>
        <form method="post" action="/setup" class="setup-form" data-busy-form data-busy-stages="Checking the printer address|Configuring the print service|Waiting for the printer to respond">
          <input type="hidden" name="_csrf_token" value="${escapeHtml(csrf)}">
          <label for="printer-ip">Printer IP address</label>
          <div class="field-action">
            <input id="printer-ip" class="input" type="text" inputmode="decimal" autocomplete="off" name="printer_ip" placeholder="192.168.1.50" required>
            <button type="submit" data-busy-text="Connecting…">Connect</button>
          </div>
          <small>Tip: reserve this address in your router so it does not change.</small>
        </form>
      </section>`:`
      <header class="intro">
        <div>
          <p class="kicker">Ready when you are</p>
          <h1>What would you like to do?</h1>
          <p>Print a file or scan a document without installing anything on this device.</p>
        </div>
        <div class="service-summary" aria-label="Service status">
          <span><i id="summary-printer-dot" class="service-dot ${printer.ok?"good":"bad"}"></i><span id="summary-printer-text">Printer ${escapeHtml(printer.state.replace("_"," "))}</span></span>
          <span><i id="summary-scanner-dot" class="service-dot ${scanner.ok?"good":"warn"}"></i><span id="summary-scanner-text">Scanner ${scanner.ok?"ready":"unavailable"}</span></span>
        </div>
      </header>

      <section class="action-grid" aria-label="Print and scan">
        <article class="panel task-card print-card">
          <div class="task-heading">
            <span class="task-icon print" aria-hidden="true">↥</span>
            <div><p class="kicker">Print</p><h2>Put a file on paper</h2></div>
          </div>
          <form method="post" action="/print" enctype="multipart/form-data" data-busy-form data-busy-stages="Uploading the file|Preparing the print job|Waiting for the printer queue">
            <input type="hidden" name="_csrf_token" value="${escapeHtml(csrf)}">
            <label class="file-picker" for="print-file">
              <input id="print-file" type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,.txt" required data-file-input data-max-mb="${MAX_UPLOAD_MB}">
              <span class="file-glyph" aria-hidden="true">＋</span>
              <span><strong data-file-label>Choose a file</strong><small>PDF, image or text · up to ${MAX_UPLOAD_MB} MB</small></span>
            </label>
            <div id="file-inline-error" class="field-error" hidden role="alert"></div>
            <div class="options-row">
              <label for="copies">Copies
                <input id="copies" class="input compact" type="number" name="copies" value="1" min="1" max="99">
              </label>
              <label class="check-option"><input type="checkbox" name="grayscale"><span>Black &amp; white</span></label>
            </div>
            <button class="primary-action" type="submit" data-busy-text="Sending to printer…">Print file</button>
          </form>
        </article>

        <article class="panel task-card scan-card">
          <div class="task-heading">
            <span class="task-icon scan" aria-hidden="true">⌑</span>
            <div><p class="kicker">Scan</p><h2>Make a digital copy</h2></div>
          </div>
          ${scanner.ok?`
            <form method="post" action="/scan" data-busy-form data-busy-stages="Contacting the scanner|Scanning the document|Preparing the download" data-busy-stage-seconds="15">
              <input type="hidden" name="_csrf_token" value="${escapeHtml(csrf)}">
              <div class="scan-options">
                <label for="mode">Colour
                  <select id="mode" class="input" name="mode"><option>Color</option><option>Gray</option><option>Lineart</option></select>
                </label>
                <label for="dpi">Quality
                  <select id="dpi" class="input" name="dpi"><option value="150">Quick</option><option value="200">Standard</option><option value="300" selected>High</option><option value="600">Very high</option></select>
                </label>
                <label for="format">Save as
                  <select id="format" class="input" name="format"><option value="pdf" selected>PDF</option><option value="png">PNG</option><option value="jpg">JPG</option></select>
                </label>
              </div>
              <p class="help-text">Place the document face-down on the glass, then press scan.</p>
              <button class="primary-action teal" type="submit" data-busy-text="Scanning… this can take a minute">Scan document</button>
            </form>
          `:`
            <div class="empty-action">
              <strong>Scanner is starting</strong>
              <p>The scanner service sets itself up automatically. Check again in a minute.</p>
            </div>
          `}
        </article>
      </section>

      <section class="status-strip panel" aria-label="Current devices">
        <div class="device-status">
          <i id="status-printer-dot" class="service-dot ${printer.ok?"good":"bad"}"></i>
          <span><small>Printer</small><strong id="status-printer-text">${escapeHtml(printer.state.replace("_"," ").replace(/\b\w/g,(s:string)=>s.toUpperCase()))}</strong></span>
          <span class="device-detail">${escapeHtml(displayName)} · ${escapeHtml(printerIp)}</span>
        </div>
        <div class="device-status">
          <i id="status-scanner-dot" class="service-dot ${scanner.ok?"good":"warn"}"></i>
          <span><small>Scanner</small><strong id="status-scanner-text">${scanner.ok?"Ready":"Starting"}</strong></span>
          <span id="status-scanner-detail" class="device-detail">${escapeHtml(scanner.ok?(scanner.backend||"Ready"):"Automatic setup in progress")}</span>
        </div>
        <div class="device-status">
          <i id="status-queue-dot" class="service-dot ${jobs.length?"warn":"good"}"></i>
          <span><small>Print queue</small><strong id="status-queue-text">${jobs.length} ${jobs.length===1?"job":"jobs"}</strong></span>
          <span id="status-queue-detail" class="device-detail">${jobs.length?"Working through the queue":"Nothing waiting"}</span>
        </div>
      </section>
      <div id="live-indicator" class="live-indicator" aria-live="polite" aria-atomic="true"><span id="live-dot"></span><span id="live-text">Live</span><span id="live-time" class="live-time"></span></div>
      ${inkHtml}

      <section class="activity-grid" id="activity-grid" ${!(jobs.length||scans.length)?"hidden":""}>
        <article class="panel compact-panel" id="queue-panel" ${!jobs.length?"hidden":""}>
          <div class="section-heading"><div><p class="kicker">In progress</p><h2>Print queue</h2></div></div>
          <div class="item-list" id="queue-list">
            ${jobs.map(job=>`
            <div class="item-row">
              <span><strong>${escapeHtml(job.id)}</strong><small>${escapeHtml(job.owner)} · ${escapeHtml(job.size)}</small></span>
              <form method="post" action="/jobs/${encodeURIComponent(job.id)}/cancel">
                <input type="hidden" name="_csrf_token" value="${escapeHtml(csrf)}">
                <button class="button-quiet danger" type="submit">Cancel</button>
              </form>
            </div>
            `).join("")}
          </div>
        </article>
        <article class="panel compact-panel" id="scans-panel" ${!scans.length?"hidden":""}>
          <div class="section-heading"><div><p class="kicker">Downloads</p><h2>Recent scans</h2></div></div>
          <div class="item-list" id="scans-list">
            ${scans.map(scan=>`<a class="item-row" href="/scans/${encodeURIComponent(scan.name)}"><span><strong>${escapeHtml(scan.name)}</strong><small>Saved scan</small></span><span class="download">Download</span></a>`).join("")}
          </div>
        </article>
      </section>

      <details class="panel fold">
        <summary><span><strong>Connect phones and computers</strong><small>Share this printer around the house</small></span><span class="summary-state ${sharePrinter?"on":""}">${sharePrinter?"Sharing on":"Sharing off"}</span></summary>
        <div class="fold-content network-grid">
          <form method="post" action="/client-settings" class="settings-form" data-busy-form data-busy-stages="Validating the settings|Updating the print queue|Refreshing network sharing">
            <input type="hidden" name="_csrf_token" value="${escapeHtml(csrf)}">
            <label for="display-name">Printer name<input id="display-name" class="input" type="text" name="display_name" value="${escapeHtml(displayName)}" maxlength="80" required></label>
            <label for="queue-name">Technical queue name<input id="queue-name" class="input" type="text" name="printer_name" value="${escapeHtml(printerName)}" pattern="[A-Za-z0-9._-]+" maxlength="127" required></label>
            <label class="toggle"><input type="checkbox" name="share_printer" ${sharePrinter?"checked":""}><span><strong>Share on the home network</strong><small>Allows AirPrint, Windows and Linux devices to find it.</small></span></label>
            <button type="submit" data-busy-text="Saving…">Save sharing settings</button>
          </form>
          <div class="connection-help">
            ${sharePrinter?`
              <h3>Automatic setup</h3>
              <p>On most devices, add a printer and choose <strong>${escapeHtml(displayName)}</strong> from the list.</p>
              <h3>Manual address</h3>
              <div class="copy-row"><code>${escapeHtml(clientSetupData.ipp_uri)}</code><button class="button-quiet" type="button" data-copy="${escapeHtml(clientSetupData.ipp_uri)}">Copy</button></div>
              <details class="platform-help"><summary>Windows and Mac instructions</summary>
                <div class="platform-columns">
                  <div><h4>Windows</h4><p>Settings → Bluetooth &amp; devices → Printers &amp; scanners → Add device. If needed, add manually with <code>${escapeHtml(clientSetupData.http_uri)}</code>.</p></div>
                  <div><h4>Mac</h4><p>System Settings → Printers &amp; Scanners → Add Printer, then choose <strong>${escapeHtml(displayName)}</strong>.</p></div>
                </div>
              </details>
            `:`<h3>Sharing is off</h3><p>Turn it on to let other devices find and use this printer.</p>`}
          </div>
        </div>
      </details>

      <details class="panel fold" id="history-fold">
        <summary><span><strong>Print history</strong><small id="history-summary">${history.length} recent ${history.length===1?"job":"jobs"} · file contents are not stored</small></span></summary>
        <div class="fold-content history-content">
          <div class="history-wrap" id="history-wrap" ${!history.length?"hidden":""}>
            <table>
              <thead><tr><th>Document</th><th>When</th><th>From</th><th>Status</th><th>Size</th></tr></thead>
              <tbody id="history-tbody">
              ${history.map(job=>`
                <tr>
                  <td data-label="Document"><strong>${escapeHtml(job.document)}</strong><small>#${escapeHtml(String(job.job_id))}</small></td>
                  <td data-label="When">${escapeHtml(job.created_display)}</td>
                  <td data-label="From">${escapeHtml(job.origin_host||job.user_name||job.source)}</td>
                  <td data-label="Status"><span class="job-state state-${escapeHtml(job.state)}">${escapeHtml(job.state.replace("_"," ").replace(/\b\w/g,(s:string)=>s.toUpperCase()))}</span></td>
                  <td data-label="Size">${escapeHtml(job.size_display)}</td>
                </tr>`).join("")}
              </tbody>
            </table>
          </div>
          <p class="empty-copy" id="history-empty" ${history.length?"hidden":""}>No print history yet.</p>
        </div>
      </details>

      <details class="panel fold">
        <summary><span><strong>Printer settings</strong><small>Change the printer address</small></span></summary>
        <div class="fold-content narrow-content">
          <form method="post" action="/setup" class="settings-form" data-busy-form data-busy-stages="Checking the printer address|Updating the print service|Waiting for the printer to respond">
            <input type="hidden" name="_csrf_token" value="${escapeHtml(csrf)}">
            <label for="change-printer-ip">Printer IP address<input id="change-printer-ip" class="input" type="text" inputmode="decimal" name="printer_ip" value="${escapeHtml(printerIp)}" required></label>
            <button type="submit" data-busy-text="Checking printer…">Save address</button>
          </form>
        </div>
      </details>
    `;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f4f6f8">
  <title>Home Print Hub</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%232b61d1'/%3E%3Cpath d='M18 25h28a8 8 0 0 1 8 8v13H10V33a8 8 0 0 1 8-8Zm5-14h18v14H23V11Zm0 27h18v15H23V38Z' fill='white'/%3E%3Ccircle cx='45' cy='33' r='2' fill='%238fd3c7'/%3E%3C/svg%3E">
  <link rel="stylesheet" href="/static/style.css">
  <script defer src="/static/app.js"></script>
</head>
<body ${printerIp?`data-printer-ip="${escapeHtml(printerIp)}" data-poll-interval="3000"`:""}>
  <nav class="topbar" aria-label="Home Print Hub">
    <a class="brand" href="/" aria-label="Home Print Hub home">
      <span class="brand-mark" aria-hidden="true">P</span>
      <span><strong>Home Print Hub</strong><small>Epson XP-2200</small></span>
    </a>
    ${healthBadge}
  </nav>
  <main class="shell">
    ${flashHtml}
    ${welcomeOrMain}
  </main>
  <footer>Private home service · Keep ZimaOS and this printer hub on your local network.</footer>
</body>
</html>`;
}

