import * as stylex from "@stylexjs/stylex";
import { vars } from "../styles/tokens.stylex";
import { useState } from "react";
import { Ban, Loader2, WifiOff } from "lucide-react";
import { useToast } from "./Toast";
import { cancelPrintJob, resumePrintQueue } from "../lib/api";
import { s as ui, Card, StatusDot, safeLabel } from "./ui";

export type QueueJob = { id: string; owner: string; size: string; raw: string };

const s = stylex.create({
  strip: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "1px",
    backgroundColor: vars.line,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.line,
    borderRadius: vars.radiusLg,
    overflow: "hidden",
  },
  cell: {
    backgroundColor: vars.panel,
    padding: "14px 16px",
    "@media (max-width: 600px)": { padding: "12px 8px" },
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    minWidth: 0,
  },
  label: {
    fontFamily: vars.fontSans,
    fontSize: "11px",
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: vars.textTertiary,
    display: "flex",
    alignItems: "center",
    gap: "7px",
  },
  value: {
    fontFamily: vars.fontSans,
    fontSize: "14.5px",
    fontWeight: 600,
    color: vars.text,
    textTransform: "capitalize",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  detail: {
    fontFamily: vars.fontMono,
    fontSize: "11.5px",
    color: vars.textTertiary,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  jobRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "12px 4px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: vars.line,
  },
  jobId: { fontFamily: vars.fontMono, fontSize: "12.5px", fontWeight: 600, color: vars.text },
  jobMeta: { fontFamily: vars.fontSans, fontSize: "12px", color: vars.textTertiary, marginTop: "2px" },
});

export function StatusStrip({ printerOk, printerState, printerDetail, scannerOk, scannerState, scannerDetail, queueCount, printerChecking = false, scannerChecking = false, queueChecking = false }: {
  printerChecking?: boolean; scannerChecking?: boolean; queueChecking?: boolean;
  printerOk: boolean; printerState: string; printerDetail: string;
  scannerOk: boolean; scannerState: string; scannerDetail: string; queueCount: number;
}) {
  return (
    <div {...stylex.props(s.strip)} aria-label="Device status">
      <div {...stylex.props(s.cell)}>
        <span {...stylex.props(s.label)}><StatusDot tone={printerChecking ? "idle" : printerOk ? "good" : "bad"} /> Printer</span>
        <span {...stylex.props(s.value)}>{printerChecking && printerState === "unknown" ? "Checking…" : safeLabel(printerState)}</span>
        <span {...stylex.props(s.detail)} title={printerDetail}>{printerChecking && printerState !== "unknown" ? "Last known · " : ""}{printerDetail || "—"}</span>
      </div>
      <div {...stylex.props(s.cell)}>
        <span {...stylex.props(s.label)}><StatusDot tone={scannerChecking ? "idle" : scannerOk ? "good" : "warn"} /> Scanner</span>
        <span {...stylex.props(s.value)}>{scannerChecking && scannerState === "unknown" ? "Checking…" : safeLabel(scannerState)}</span>
        <span {...stylex.props(s.detail)} title={scannerDetail}>{scannerChecking && scannerState !== "unknown" ? "Last known · " : ""}{scannerDetail || "—"}</span>
      </div>
      <div {...stylex.props(s.cell)}>
        <span {...stylex.props(s.label)}><StatusDot tone={queueChecking ? "idle" : queueCount > 0 ? "warn" : "good"} /> Queue</span>
        <span {...stylex.props(s.value)}>{queueChecking ? "Checking…" : `${queueCount} ${queueCount === 1 ? "job" : "jobs"}`}</span>
        <span {...stylex.props(s.detail)}>{queueChecking ? "Reading the print queue" : queueCount > 0 ? "Waiting or printing" : "Ready for your next document"}</span>
      </div>
    </div>
  );
}

export type PrinterNetwork = {
  serverIps: string[];
  sameSubnet: boolean | null;
  hint: string;
} | null;

export function PrinterUnreachableBanner({ network, queuedJobs, recoveryMessage }: Readonly<{ network: PrinterNetwork; queuedJobs: number; recoveryMessage?: string }>) {
  const hint = recoveryMessage || network?.hint;
  const waitingJobs = queuedJobs === 1 ? "queued job will wait" : "queued jobs will wait";
  const queueMessage = queuedJobs > 0 ? ` ${queuedJobs} ${waitingJobs} until it reconnects.` : "";
  return <div className="connection-notice"><WifiOff size={18} /><div>
    <output><strong>Waiting for your printer</strong><span className="connection-summary">Turn it on and check its Wi-Fi connection.{queueMessage}</span></output>
    <a href="#settings">Find and reconnect in Settings</a>
    {hint ? <details><summary>Connection details</summary><p>{hint}</p></details> : null}
  </div></div>;
}

export function Queue({ jobs, onChanged }: { jobs: QueueJob[]; onChanged: () => void }) {
  const { push } = useToast();
  const [pending, setPending] = useState<Set<string>>(new Set());

  if (jobs.length === 0) return null;

  const cancel = async (id: string) => {
    if (pending.has(id)) return;
    setPending((p) => new Set(p).add(id));
    try {
      await cancelPrintJob(id);
      push({ kind: "success", title: "Job cancelled", desc: id });
      onChanged();
    } catch (err: any) {
      push({ kind: "error", title: "Couldn't cancel the job", desc: String(err.message || err).slice(0, 200) });
    } finally {
      setPending((p) => { const n = new Set(p); n.delete(id); return n; });
    }
  };

  return (
    <Card>
      <div {...stylex.props(ui.sectionHead)}>
        <h2 {...stylex.props(ui.sectionTitle)}>Print queue · {jobs.length}</h2>
      </div>
      <div>
        {jobs.map((j) => (
          <div key={j.id} {...stylex.props(s.jobRow)}>
            <Loader2 size={15} className="spin" style={{ flexShrink: 0, color: vars.accent as string }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div {...stylex.props(s.jobId)}>{j.id}</div>
              <div {...stylex.props(s.jobMeta)}>{j.owner} · {j.size}</div>
            </div>
            <button {...stylex.props(ui.buttonQuiet, ui.buttonDanger)} onClick={() => cancel(j.id)} disabled={pending.has(j.id)} style={pending.has(j.id) ? { opacity: 0.5 } : undefined}>
              <Ban size={13} /> {pending.has(j.id) ? "Cancelling…" : "Cancel"}
            </button>
          </div>
        ))}
      </div>
      <style>{`.spin{animation:spin 1.4s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </Card>
  );
}


export function QueueAttention({ onChanged }: Readonly<{ onChanged: () => void }>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const resume = async () => {
    setBusy(true); setError("");
    try { await resumePrintQueue(); onChanged(); }
    catch (error) { setError((error as Error).message || "Could not resume the queue."); }
    finally { setBusy(false); }
  };
  return <div className="queue-attention" role="alert"><div><strong>Printing is paused</strong><p>Check the paper tray and clear any printer error, then resume your waiting jobs.</p>{error ? <p>{error}</p> : null}</div><button {...stylex.props(ui.buttonQuiet)} type="button" disabled={busy} onClick={resume}>{busy ? <Loader2 size={14} className="spin" /> : null}{busy ? "Resuming…" : "Resume printing"}</button></div>;
}
