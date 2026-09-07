import * as stylex from "@stylexjs/stylex";
import { vars } from "../styles/tokens.stylex";
import { useEffect, useRef, useState } from "react";
import { Loader2, ScanLine, X } from "lucide-react";
import { useToast } from "./Toast";
import { postScan, startScanJob, pollScanJob, cancelScanJob } from "../lib/api";
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

export function ScanCard({ scannerOk, onScanned }: { scannerOk: boolean; onScanned: () => void }) {
  const { push } = useToast();
  const [mode, setMode] = useState("Color");
  const [dpi, setDpi] = useState("300");
  const [fmt, setFmt] = useState("pdf");
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const cancelRef = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => {
    cancelRef.current = true;
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);

  useEffect(() => {
    if (!busy || !startedAt) return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy, startedAt]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!["150", "200", "300", "600"].includes(dpi)) {
      push({ kind: "error", title: "Pick a valid quality setting." });
      return;
    }
    cancelRef.current = false;
    setBusy(true);
    setProgress("Contacting scanner");
    setElapsed(0);
    setStartedAt(Date.now());
    try {
      const { jobId: id } = await startScanJob({ dpi, mode, format: fmt });
      setJobId(id);
      let done = false;
      let polls = 0;
      let consecutiveErrors = 0;
      while (!done && !cancelRef.current) {
        await new Promise<void>((r) => { const t = setTimeout(() => r(), 1500); timers.current.push(t); });
        if (cancelRef.current) break;
        polls++;
        if (polls > 300) {
          push({ kind: "error", title: "Scan timed out", desc: "Still not done after several minutes. Check the printer, then try again." });
          break;
        }
        try {
          const job = await pollScanJob(id);
          consecutiveErrors = 0;
          setProgress(job.progress);
          if (job.state === "done") {
            done = true;
            push({ kind: "success", title: "Scan complete", desc: `${job.resultName || "Scan"} · ${fmt.toUpperCase()} · ${dpi} dpi · ${job.elapsed}s` });
            onScanned();
          } else if (job.state === "error" || job.state === "cancelled") {
            done = true;
            if (cancelRef.current) break;
            const msg = job.error || "Scan failed";
            if (msg.toLowerCase().includes("already in progress")) {
              push({ kind: "error", title: "A scan is already running", desc: "Wait for it to finish before starting another." });
            } else if (msg.toLowerCase().includes("cancel")) {
              push({ kind: "info", title: "Scan cancelled" });
            } else {
              push({ kind: "error", title: "Scan failed", desc: msg.slice(0, 240) });
            }
          }
        } catch (pollErr: any) {
          consecutiveErrors++;
          if (consecutiveErrors > 6) throw pollErr;
        }
      }
    } catch (err: any) {
      const msg = String(err.message || err);
      if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
        try {
          const fd = new FormData();
          fd.set("dpi", dpi);
          fd.set("mode", mode);
          fd.set("format", fmt);
          await postScan(fd);
          push({ kind: "success", title: "Scan complete", desc: `Saved as ${fmt.toUpperCase()} · ${dpi} dpi` });
          onScanned();
        } catch (e2: any) {
          push({ kind: "error", title: "Scan failed", desc: String(e2.message || e2).slice(0, 220) });
        }
      } else if (!msg.toLowerCase().includes("already in progress") && !msg.toLowerCase().includes("timed out")) {
        push({ kind: "error", title: "Scan failed", desc: msg.slice(0, 220) });
      }
    } finally {
      setBusy(false);
      setJobId(null);
    }
  };

  const cancel = async () => {
    if (!jobId) return;
    cancelRef.current = true;
    setProgress("Cancelling");
    try {
      await cancelScanJob(jobId);
    } catch (err: any) {
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
        sub="Flatbed · A4 · straight to this device"
      />
      {!scannerOk && !busy ? (
        <div {...stylex.props(s.dormant)}>
          The scanner is warming up. You can still try — the scan will go through as soon as it's ready.
        </div>
      ) : null}
      <form onSubmit={submit} style={{ marginTop: scannerOk || busy ? 0 : 12 }}>
        <div {...stylex.props(s.grid)}>
          <label {...stylex.props(ui.fieldLabel)}>
            Colour
            <select {...stylex.props(ui.select)} value={mode} onChange={(e) => setMode(e.target.value)}>
              <option>Color</option>
              <option>Gray</option>
              <option>Lineart</option>
            </select>
          </label>
          <label {...stylex.props(ui.fieldLabel)}>
            Quality
            <select {...stylex.props(ui.select)} value={dpi} onChange={(e) => setDpi(e.target.value)}>
              {DPI_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label {...stylex.props(ui.fieldLabel)}>
            Format
            <select {...stylex.props(ui.select)} value={fmt} onChange={(e) => setFmt(e.target.value)}>
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
        <div style={{ marginTop: 14 }}>
          <button {...stylex.props(ui.buttonPrimary, ui.buttonTeal, busy && ui.buttonPrimaryDisabled)} type="submit" disabled={busy}>
            {busy ? <><Loader2 size={16} className="spin" /> Scanning{elapsed > 0 ? ` · ${elapsed}s` : "…"}</> : "Scan"}
          </button>
          {busy ? (
            <div style={{ marginTop: 10 }}>
              <ProgressBar color={vars.teal as string} />
              <p {...stylex.props(s.stage)}>{progress || "Working"} · {elapsed}s</p>
              <button type="button" {...stylex.props(ui.buttonQuiet, ui.buttonDanger, s.cancel)} onClick={cancel}>
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
