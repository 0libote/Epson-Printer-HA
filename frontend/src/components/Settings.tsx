import * as stylex from "@stylexjs/stylex";
import { vars } from "../styles/tokens.stylex";
import { useEffect, useState } from "react";
import { Check, Copy, Loader2, Radar } from "lucide-react";
import { useToast } from "./Toast";
import { fetchDiagnostics, rediscoverScanner, postClientSettings, postSetup, isPlausiblePrinterIpv4, fetchDiscovered, type DiscoveredPrinter } from "../lib/api";
import { s as ui, Card, StatusDot } from "./ui";

const s = stylex.create({
  stack: { display: "grid", gap: "14px" },
  cols: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
    "@media (max-width: 520px)": { gridTemplateColumns: "1fr" },
  },
  toggle: { display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", fontFamily: vars.fontSans, fontSize: "13.5px", color: vars.text },
  toggleSub: { display: "block", fontSize: "12.5px", color: vars.textTertiary, marginTop: "2px", fontWeight: 400 },
  uriRow: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
  code: {
    fontFamily: vars.fontMono,
    fontSize: "12px",
    color: vars.text,
    backgroundColor: vars.bgSunken,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.line,
    borderRadius: vars.radiusSm,
    padding: "8px 10px",
    overflowWrap: "anywhere",
    flex: 1,
    minWidth: "200px",
  },
  h3: { fontFamily: vars.fontSans, fontSize: "13.5px", fontWeight: 600, color: vars.text, marginTop: "18px" },
  p: { fontFamily: vars.fontSans, fontSize: "13px", lineHeight: 1.55, color: vars.textSecondary, marginTop: "6px" },
  copied: { color: vars.good },
});

function useCopy() {
  const { push } = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // LAN dashboards commonly use HTTP, where the Clipboard API is absent.
        const previousFocus = document.activeElement as HTMLElement | null;
        const field = document.createElement("textarea");
        field.value = text;
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        try {
          field.select();
          if (!document.execCommand("copy")) throw new Error("Clipboard unavailable");
        } finally {
          field.remove();
          previousFocus?.focus();
        }
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      push({ kind: "error", title: "Copy failed", desc: "Select the address and copy it manually." });
    }
  };
  return { copy, copied };
}

export function SharingSettings({ displayName, printerName, sharing, host, onSaved }: {
  displayName: string; printerName: string; sharing: boolean; host: string; onSaved: () => void;
}) {
  const { push } = useToast();
  const { copy, copied } = useCopy();
  const [nameEdit, setNameEdit] = useState(displayName);
  const [queueEdit, setQueueEdit] = useState(printerName);
  const [shareEdit, setShareEdit] = useState(sharing);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNameEdit(displayName);
    setQueueEdit(printerName);
    setShareEdit(sharing);
  }, [displayName, printerName, sharing]);

  const ippUri = `ipp://${host}:631/printers/${printerName}`;
  const httpUri = `http://${host}:631/printers/${printerName}`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameEdit.trim() || nameEdit.trim().length > 80) {
      push({ kind: "error", title: "Display name must be 1–80 characters." });
      return;
    }
    if (!/^[A-Za-z0-9._-]{1,127}$/.test(queueEdit.trim()) || [".", ".."].includes(queueEdit.trim())) {
      push({ kind: "error", title: "Queue name may only contain letters, numbers, dot, dash and underscore." });
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("display_name", nameEdit.trim());
      fd.set("printer_name", queueEdit.trim());
      if (shareEdit) fd.set("share_printer", "on");
      await postClientSettings(fd);
      push({ kind: "success", title: "Sharing settings saved" });
      onSaved();
    } catch (err: any) {
      push({ kind: "error", title: "Couldn't save sharing settings", desc: String(err.message || err).slice(0, 220) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div {...stylex.props(ui.sectionHead)}>
        <h2 {...stylex.props(ui.sectionTitle)}>Network sharing</h2>
      </div>
      <form {...stylex.props(s.stack)} onSubmit={submit}>
        <div {...stylex.props(s.cols)}>
          <label {...stylex.props(ui.fieldLabel)}>
            Display name
            <input {...stylex.props(ui.input)} value={nameEdit} onChange={(e) => setNameEdit(e.target.value)} maxLength={80} required />
          </label>
          <label {...stylex.props(ui.fieldLabel)}>
            Queue name
            <input {...stylex.props(ui.input, ui.mono)} value={queueEdit} onChange={(e) => setQueueEdit(e.target.value)} maxLength={127} required />
          </label>
        </div>
        <label {...stylex.props(s.toggle)}>
          <input
            type="checkbox"
            checked={shareEdit}
            onChange={(e) => setShareEdit(e.target.checked)}
            style={{ width: 17, height: 17, marginTop: 1, accentColor: vars.accent as string }}
          />
          <span>
            Share on the home network
            <span {...stylex.props(s.toggleSub)}>Lets phones and computers find the printer over IPP.</span>
          </span>
        </label>
        <div>
          <button {...stylex.props(ui.buttonQuiet)} type="submit" disabled={busy} style={busy ? { opacity: 0.5 } : undefined}>
            {busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Save settings
          </button>
        </div>
      </form>

      {sharing ? (
        <>
          <h3 {...stylex.props(s.h3)}>Connect a device</h3>
          <p {...stylex.props(s.p)}>
            On most devices, just add a printer and pick <strong>{displayName}</strong> from the list.
            If it doesn't appear, add it manually:
          </p>
          <div {...stylex.props(s.uriRow)} style={{ marginTop: 10 }}>
            <code {...stylex.props(s.code)}>{ippUri}</code>
            <button type="button" {...stylex.props(ui.buttonQuiet)} onClick={() => copy(ippUri)} aria-label="Copy printer address">
              {copied ? <Check size={13} {...stylex.props(s.copied)} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p {...stylex.props(s.p)} style={{ marginTop: 10 }}>
            Windows: Settings → Bluetooth &amp; devices → Printers &amp; scanners → Add device (manual address: {httpUri}).
            Mac: System Settings → Printers &amp; Scanners → Add Printer.
          </p>
        </>
      ) : (
        <div {...stylex.props(ui.noteBox)} style={{ marginTop: 14 }}>
          Sharing is off. Turn it on to let other devices on the network find this printer.
        </div>
      )}
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </Card>
  );
}

export function PrinterAddressSettings({ printerIp, onSaved }: { printerIp: string; onSaved: () => void }) {
  const { push } = useToast();
  const [ip, setIp] = useState(printerIp);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<DiscoveredPrinter[] | null>(null);
  const [scannedAt, setScannedAt] = useState<string | null>(null);

  useEffect(() => setIp(printerIp), [printerIp]);

  const search = async () => {
    setScanning(true);
    try {
      // Explicit searches always force a fresh sweep (never a cached one).
      const res = await fetchDiscovered(true);
      setResults(res.printers);
      setScannedAt(res.scanned_at);
      if (!res.ok) {
        push({ kind: "error", title: "Network search failed", desc: (res.message || "Try again.").slice(0, 200) });
      } else if (!res.printers.length) {
        push({ kind: "info", title: "No printers found", desc: "Check the printer is powered on with solid Wi-Fi on this network, then try again." });
      }
    } catch (err: any) {
      push({ kind: "error", title: "Network search failed", desc: String(err.message || err).slice(0, 200) });
    } finally {
      setScanning(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = ip.trim();
    if (!v) return;
    if (!isPlausiblePrinterIpv4(v)) {
      push({ kind: "error", title: "That doesn't look like a printer address", desc: "Use the printer's normal IPv4 address, e.g. 192.168.1.50." });
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("printer_ip", v);
      await postSetup(fd);
      push({ kind: "success", title: "Printer address updated", desc: v });
      onSaved();
    } catch (err: any) {
      push({ kind: "error", title: "Couldn't update the address", desc: String(err.message || err).slice(0, 220) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div {...stylex.props(ui.sectionHead)}>
        <h2 {...stylex.props(ui.sectionTitle)}>Printer address</h2>
      </div>
      <form {...stylex.props(s.stack)} onSubmit={submit}>
        <label {...stylex.props(ui.fieldLabel)}>
          <span>Printer IP address</span>
          <input {...stylex.props(ui.input, ui.mono)} disabled={busy} value={ip} onChange={(e) => setIp(e.target.value)} placeholder="192.168.1.50" inputMode="decimal" required />
        </label>
        <div {...stylex.props(s.uriRow)}>
          <button {...stylex.props(ui.buttonQuiet)} type="submit" disabled={busy} style={busy ? { opacity: 0.5 } : undefined}>
            {busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Save address
          </button>
          <button type="button" {...stylex.props(ui.buttonQuiet)} onClick={search} disabled={scanning || busy} style={scanning ? { opacity: 0.5 } : undefined}>
            {scanning ? <Loader2 size={14} className="spin" /> : <Radar size={14} />} {scanning ? "Searching network…" : "Search network"}
          </button>
        </div>
      </form>
      {scanning ? (
        <p {...stylex.props(s.p)}>Scanning the local network for printers — this can take up to ~25 seconds.</p>
      ) : null}
      {!scanning && results ? (
        <div style={{ marginTop: 14 }}>
          <h3 {...stylex.props(s.h3)} style={{ marginTop: 0 }}>
            {results.length ? `Found ${results.length} ${results.length === 1 ? "device" : "devices"}` : "No printers found"}
          </h3>
          {results.length ? (
            <div>
              {results.map((r) => (
                <div key={r.ip} {...stylex.props(ui.statusRow)}>
                  <StatusDot tone={r.likelyEpson ? "good" : "idle"} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span {...stylex.props(ui.mono)}>{r.ip}</span>
                    <span {...stylex.props(s.toggleSub)}>{r.model ? `${r.model} · ` : ""}{r.detail}</span>
                  </span>
                  <button type="button" {...stylex.props(ui.buttonQuiet)} onClick={() => setIp(r.ip)}>
                    Use this address
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p {...stylex.props(s.p)}>
              Nothing with printer ports answered{scannedAt ? ` (searched ${new Date(scannedAt).toLocaleTimeString()})` : ""}.
              Make sure the printer is powered on with solid Wi-Fi on the same network as this hub.
            </p>
          )}
        </div>
      ) : null}
    </Card>
  );
}

export function BackendDiagnostics({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<import("../lib/api").DiagnosticsResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = async (rediscover = false) => {
    setBusy(true); setError("");
    try {
      if (rediscover) await rediscoverScanner();
      setData(await fetchDiagnostics());
      if (rediscover) onChanged();
    } catch { setError("Diagnostics unavailable. Try again when the scanner service is ready."); }
    finally { setBusy(false); }
  };
  useEffect(() => { void refresh(); }, []);
  return <Card>
    <h2 {...stylex.props(ui.sectionTitle)}>Backend diagnostics</h2>
    {error ? <p role="alert">{error}</p> : null}
    {data ? <>
      <dl>
        <dt>Application</dt><dd>{data.version} · {data.architecture}</dd>
        <dt>Printing</dt><dd>CUPS {data.printing.cups || "version unavailable"} · ESC/P-R {data.printing.escpr || "version unavailable"}</dd>
        <dt>Scanning</dt><dd>{data.scanner.backends.find(b => b.id === data.scanner.selected)?.name || "No backend detected"}</dd>
        <dt>Available scanner backends</dt><dd>{data.scanner.backends.map(b => b.name).join(", ") || "None detected"}</dd>
        <dt>Scanner capabilities</dt><dd>{data.scanner.capabilities?.verified ? `${data.scanner.capabilities.resolutions.join(", ")} DPI · ${data.scanner.capabilities.modes.join(", ")}` : "Unverified; legacy settings remain available"}</dd>
        <dt>Epson Scan 2</dt><dd>{data.epsonScan2.version || "Direct service unavailable"}{data.epsonScan2.available && !data.epsonScan2.profilesValidated ? " · No validated profiles" : ""}</dd>
        <dt>Printer status</dt><dd>{data.printer.backend} · SNMP → IPP → HTTP fallback</dd>
        <dt>Epson Printer Utility</dt><dd>{data.epsonUtility.available ? data.epsonUtility.version : data.epsonUtility.reason}</dd>
      </dl>
      {data.scanner.backends.filter(b => b.lastError).map(b => <p key={b.id}>{b.name}: {b.lastError}</p>)}
      {data.epsonScan2.lastError && data.epsonScan2.available ? <p>{data.epsonScan2.lastError}</p> : null}
    </> : !error ? <p>Loading diagnostics…</p> : null}
    <button {...stylex.props(ui.buttonQuiet)} disabled={busy} onClick={() => refresh(true)}>{busy ? "Discovering…" : "Rediscover scanner"}</button>
  </Card>;
}
