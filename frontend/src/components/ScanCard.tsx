import * as stylex from "@stylexjs/stylex";
import { vars } from "../styles/tokens.stylex";
import { useEffect, useRef, useState } from "react";
import { Loader2, ScanLine, X } from "lucide-react";
import { useToast } from "./Toast";
import { startScanJob, pollScanJob, cancelScanJob, cancelAllScans } from "../lib/api";
import { s as ui, Card, CardHeader, ProgressBar } from "./ui";

const s = stylex.create({
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: "12px",
    marginTop: "4px",
    "@media (max-width: 420px)": { gridTemplateColumns: "1fr" },
  },
  stage: { fontFamily: vars.fontSans, fontSize: "12.5px", color: vars.textSecondary, marginTop: "10px" },
  cancel: { marginTop: "10px", width: "100%" },
  dormant: {
    padding: "22px 16px",
    textAlign: "center",
    borderRadius: vars.radiusMd,
    backgroundColor: vars.bgSunken,
    fontFamily: vars.fontSans,
    fontSize: "13px",
    color: vars.textSecondary,
    lineHeight: 1.55,
  },
});

const DPI_OPTIONS = [
  { value: "150", label: "Quick · 150" },
  { value: "200", label: "Standard · 200" },
  { value: "300", label: "High · 300" },
  { value: "600", label: "Max · 600" },
];

export function ScanCard({ scannerOk, scannerDetail, onScanned }: { scannerOk: boolean; scannerDetail?: string; onScanned: () => void }) {
  const { push } = useToast();
  const [mode, setMode] = useState("Color");
  const [dpi, setDpi] = useState("300");
  const [fmt, setFmt] = useState("pdf");
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [stuckJobId, setStuckJobId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const onScannedRef = useRef(onScanned);
  onScannedRef.current = onScanned;

  useEffect(() => {
    let disposed = false;
    const saved = sessionStorage.getItem("scanJobId");
    if (saved && /^[a-f0-9]{12}$/.test(saved)) {
      pollScanJob(saved).then(job => {
        if (disposed) return;
        setJobId(saved);
        setStartedAt(job.startedAt || job.createdAt);
        setBusy(true);
      }).catch(() => { sessionStorage.removeItem("scanJobId"); });
    }
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (!busy || !startedAt) return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy, startedAt]);

  useEffect(() => {
    if (!jobId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const reportFinished = (job: Awaited<ReturnType<typeof pollScanJob>>) => {
          if (job.state === "done") {
            push({ kind: "success", title: "Scan complete", desc: job.resultName });
            onScannedRef.current();
          } else {
            push({ kind: job.state === "cancelled" ? "info" : "error", title: job.state === "cancelled" ? "Scan cancelled" : "Scan failed", desc: job.error });
          }
    };
    const poll = async () => {
      try {
        const job = await pollScanJob(jobId);
        if (disposed) return;
        failures = 0;
        setProgress(job.progress);
        setStartedAt(job.startedAt || job.createdAt);
        if (["done", "error", "cancelled"].includes(job.state)) {
          sessionStorage.removeItem("scanJobId");
          setBusy(false);
          setCancelling(false);
          setJobId(null);
          reportFinished(job);
          return;
        }
      } catch {
        // Transient poll failures are retried without starting another scan.
        if (disposed) return;
        failures++;
        setProgress("Connection interrupted. Reconnecting to the scan…");
        if (failures >= 7) {
          setBusy(false);
          setCancelling(false);
          setJobId(null);
          setBlocked(true);
          setStuckJobId(jobId);
          push({ kind: "error", title: "Lost contact with the scan", desc: "The scanner may still be running. Check saved scans or cancel it before retrying." });
          return;
        }
      }
      timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [jobId, push]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setProgress("Contacting scanner");
    setElapsed(0);
    setStartedAt(Date.now());
    try {
      const { jobId: id } = await startScanJob({ dpi, mode, format: fmt });
      if (!/^[a-f0-9]{12}$/.test(id)) throw new Error("The server returned an invalid scan job ID.");
      sessionStorage.setItem("scanJobId", id);
      setJobId(id);
      setBlocked(false);
      setStuckJobId(null);
    } catch (err: any) {
      setBusy(false);
      if (err.status === 409) {
        setBlocked(true);
        setStuckJobId(err.jobId || null);
        push({ kind: "info", title: "A scan is already running", desc: "Wait for it to finish, or cancel it below." });
      } else {
        push({ kind: "error", title: "Couldn't start the scan", desc: String(err.message || err).slice(0, 240) });
      }
    }
  };

  const clearStuck = async () => {
    setClearing(true);
    try {
      if (stuckJobId) await cancelScanJob(stuckJobId);
      else await cancelAllScans();
      sessionStorage.removeItem("scanJobId");
      setBlocked(false);
      setStuckJobId(null);
      push({ kind: "info", title: "Cancellation requested", desc: "Allow the scanner to stop before trying again." });
    } catch (err: any) {
      push({ kind: "error", title: "Couldn't cancel the scan", desc: String(err.message || err).slice(0, 220) });
    } finally {
      setClearing(false);
    }
  };

  const cancel = async () => {
    if (!jobId) return;
    setCancelling(true);
    try {
      await cancelScanJob(jobId);
      setProgress("Cancelling");
    } catch (err: any) {
      setCancelling(false);
      push({ kind: "error", title: "Couldn't cancel the scan", desc: String(err.message || err).slice(0, 220) });
    }
  };

  return (
    <Card>
      <CardHeader
        icon={<ScanLine size={18} />}
        tileBg={vars.tealSoft as string}
        tileColor={vars.teal as string}
        title="Scan"
        sub="Flatbed · A4 · saved to the scan library"
      />
      {!scannerOk && !busy ? (
        <div {...stylex.props(s.dormant)}>
          {scannerDetail || "Scanner not detected. Check that the printer is awake and connected before trying a scan."}
        </div>
      ) : null}
      <form onSubmit={submit} style={{ marginTop: scannerOk || busy ? 0 : 12 }}>
        <div {...stylex.props(s.grid)}>
          <label {...stylex.props(ui.fieldLabel)}>
            <span>Colour</span>
            <select disabled={busy} {...stylex.props(ui.select)} value={mode} onChange={(e) => setMode(e.target.value)}>
              <option>Color</option>
              <option>Gray</option>
              <option>Lineart</option>
            </select>
          </label>
          <label {...stylex.props(ui.fieldLabel)}>
            <span>Quality</span>
            <select disabled={busy} {...stylex.props(ui.select)} value={dpi} onChange={(e) => setDpi(e.target.value)}>
              {DPI_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label {...stylex.props(ui.fieldLabel)}>
            <span>Format</span>
            <select disabled={busy} {...stylex.props(ui.select)} value={fmt} onChange={(e) => setFmt(e.target.value)}>
              <option value="pdf">PDF</option>
              <option value="png">PNG</option>
              <option value="jpg">JPG</option>
            </select>
          </label>
        </div>
        {dpi === "600" ? (
          <div {...stylex.props(ui.noteBox)} style={{ marginTop: 12 }}>
            600 dpi scans are large and slow. Best for photos — 300 dpi is plenty for documents.
          </div>
        ) : null}
        <p {...stylex.props(ui.help)} style={{ marginTop: 12 }}>Place the page face-down on the glass, then scan.</p>
        {blocked ? (
          <div {...stylex.props(ui.noteBox)} style={{ marginTop: 12 }}>
            Another scan may be running. Cancel it only if you want to stop that scan.
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button type="button" {...stylex.props(ui.buttonQuiet)} disabled={clearing || busy} onClick={clearStuck}>
                {clearing ? "Clearing…" : "Cancel existing scan"}
              </button>
            </div>
          </div>
        ) : null}
        <div style={{ marginTop: 14 }}>
          <button {...stylex.props(ui.buttonPrimary, ui.buttonTeal, busy && ui.buttonPrimaryDisabled)} type="submit" disabled={busy || clearing}>
            {busy ? <><Loader2 size={16} className="spin" /> Scanning{elapsed > 0 ? ` · ${elapsed}s` : "…"}</> : "Scan"}
          </button>
          {busy ? (
            <div style={{ marginTop: 10 }}>
              <ProgressBar color={vars.teal as string} />
              <p {...stylex.props(s.stage)}>{progress || "Working"} · {elapsed}s</p>
              <button type="button" {...stylex.props(ui.buttonQuiet, ui.buttonDanger, s.cancel)} onClick={cancel} disabled={!jobId || cancelling}>
                <X size={13} /> Cancel scan
              </button>
            </div>
          ) : null}
        </div>
      </form>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </Card>
  );
}
