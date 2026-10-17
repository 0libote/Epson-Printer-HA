import * as stylex from "@stylexjs/stylex";
import { vars } from "../styles/tokens.stylex";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Download,
  FolderOpen,
  Loader2,
  ScanLine,
  X,
} from "lucide-react";
import { useToast } from "./Toast";
import {
  type ScannerCapabilities,
  type ScanStorage,
  startScanJob,
  pollScanJob,
  cancelScanJob,
  cancelAllScans,
} from "../lib/api";
import { s as ui, ProgressBar } from "./ui";
import { createSubmissionId } from "../lib/submission-id";
import { OperationResult } from "./OperationResult";

const s = stylex.create({
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: "12px",
    marginTop: "4px",
    "@media (max-width: 420px)": { gridTemplateColumns: "1fr" },
  },
  stage: {
    fontFamily: vars.fontSans,
    fontSize: "12.5px",
    color: vars.textSecondary,
    marginTop: "10px",
  },
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

function safeClearJob() {
  try {
    sessionStorage.removeItem("scanJobId");
  } catch {}
}

const DPI_OPTIONS = [
  { value: "150", label: "Quick · 150" },
  { value: "200", label: "Standard · 200" },
  { value: "300", label: "High · 300" },
  { value: "600", label: "Max · 600" },
];

const MODE_LABELS: Record<string, string> = {
  Color: "Colour",
  Gray: "Grayscale",
};

function scanStorageState(storage?: ScanStorage) {
  const full = !!storage?.full && storage.policy !== "delete-oldest";
  const low =
    !!storage &&
    storage.available_bytes >= 0 &&
    storage.available_bytes < 32 * 1024 * 1024;
  return { full, low, blocked: full || low };
}

function ScanFeedback({
  resultName,
  onDismiss,
  error,
  storage,
  busy,
  scannerOk,
  scannerDetail,
}: Readonly<{
  resultName: string | null;
  onDismiss: () => void;
  error: string;
  storage?: ScanStorage;
  busy: boolean;
  scannerOk: boolean;
  scannerDetail?: string;
}>) {
  const capacity = scanStorageState(storage);
  return (
    <>
      {resultName ? (
        <OperationResult
          title="Your scan is ready"
          description={resultName}
          dismissLabel="Dismiss scan result"
          onDismiss={onDismiss}
        >
          <span className="result-actions">
            <a href={`/scans/${encodeURIComponent(resultName)}`}>
              <Download size={14} /> Download scan
            </a>
            <a href="#scans">
              <FolderOpen size={14} /> Saved scans
            </a>
          </span>
        </OperationResult>
      ) : null}
      {error ? (
        <div
          {...stylex.props(ui.errorBox)}
          role="alert"
          style={{ marginBottom: 16 }}
        >
          {error}
        </div>
      ) : null}
      {capacity.blocked && !busy ? (
        <div className="scan-storage-alert" role="alert">
          <strong>
            {capacity.low
              ? "The hub is low on storage"
              : "Your saved scans are full"}
          </strong>
          <p>
            Download and delete unneeded scans before saving another page. Your
            existing documents are kept.
          </p>
          <a href="#scans">
            Manage saved scans <ArrowRight size={13} />
          </a>
        </div>
      ) : null}
      {storage?.policy === "delete-oldest" ? (
        <p className="inline-notice">
          Automatic deletion is enabled. New scans can remove older saved files.
        </p>
      ) : null}
      {!scannerOk && !busy ? (
        <div {...stylex.props(s.dormant)}>
          {scannerDetail ||
            "Scanner not detected. Check that the printer is awake and connected before trying a scan."}
        </div>
      ) : null}
    </>
  );
}

function availableScanSettings(
  capabilities: ScannerCapabilities | null | undefined,
  mode: string,
) {
  const supported = capabilities?.verified ? capabilities : null;
  const modes = supported?.modes ?? ["Color", "Gray", "Lineart"];
  const resolutions = supported?.resolutions ?? [150, 200, 300, 600];
  const formats = supported?.formats ?? ["pdf", "png", "jpg"];
  const modeResolutions = supported?.combinations
    ? resolutions.filter((value) =>
        supported.combinations!.some((p) => p.dpi === value && p.mode === mode),
      )
    : resolutions;
  return { supported, modes, modeResolutions, formats };
}

export function ScanCard({
  scannerOk,
  scannerDetail,
  capabilities,
  storage,
  onScanned,
}: Readonly<{
  scannerOk: boolean;
  scannerDetail?: string;
  capabilities?: ScannerCapabilities | null;
  storage?: ScanStorage;
  onScanned: () => void;
}>) {
  const { push } = useToast();
  const { blocked: storageBlocked } = scanStorageState(storage);
  const [resultName, setResultName] = useState<string | null>(null);
  const [scanError, setScanError] = useState("");
  const submitting = useRef(false);
  const submissionKey = useRef<string | null>(null);
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

  const { supported, modes, modeResolutions, formats } = availableScanSettings(
    capabilities,
    mode,
  );
  useEffect(() => {
    if (busy) return;
    if (!modes.includes(mode) && modes.length) setMode(modes[0]);
    if (!modeResolutions.includes(Number(dpi)) && modeResolutions.length)
      setDpi(String(modeResolutions[0]));
    if (!formats.includes(fmt) && formats.length) setFmt(formats[0]);
  }, [supported, mode, dpi, fmt, busy]);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem("scanJobId");
    } catch {}
    if (saved && /^[a-f0-9]{12}$/.test(saved)) {
      // Attach immediately; the poll loop retains this ID across network errors.
      setJobId(saved);
      setBusy(true);
      setProgress("Reconnecting to your scan…");
    }
  }, []);

  useEffect(() => {
    if (!busy || !startedAt) return;
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [busy, startedAt]);

  useEffect(() => {
    if (!jobId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const reportFinished = (job: Awaited<ReturnType<typeof pollScanJob>>) => {
      if (job.state === "done") {
        if (job.resultAvailable === false) {
          setResultName(null);
          setScanError(
            "This scan finished, but its file was renamed, deleted or removed by retention. Check Saved scans.",
          );
        } else {
          setResultName(job.resultName || null);
        }
        push({
          kind: job.resultAvailable === false ? "info" : "success",
          title:
            job.resultAvailable === false
              ? "Scan finished; file no longer available"
              : "Scan complete",
          desc: job.resultName,
        });
        onScannedRef.current();
      } else {
        if (job.state !== "cancelled")
          setScanError(
            job.error ||
              "The scan failed. Try again after checking the printer.",
          );
        push({
          kind: job.state === "cancelled" ? "info" : "error",
          title: job.state === "cancelled" ? "Scan cancelled" : "Scan failed",
          desc: job.error,
        });
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
          safeClearJob();
          setBusy(false);
          setCancelling(false);
          setJobId(null);
          reportFinished(job);
          return;
        }
      } catch (error) {
        if ((error as { status?: number }).status === 404) {
          if (disposed) return;
          safeClearJob();
          setBusy(false);
          setCancelling(false);
          setJobId(null);
          setScanError(
            "This scan is no longer tracked by the hub. Check Saved scans before starting another.",
          );
          return;
        }
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
          setScanError(
            "The connection to your scan was interrupted. Reconnect to check its result; a new scan has not been started.",
          );
          push({
            kind: "error",
            title: "Lost contact with the scan",
            desc: "The scanner may still be running. Check saved scans or cancel it before retrying.",
          });
          return;
        }
      }
      timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [jobId, push]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || submitting.current || blocked || storageBlocked) return;
    submitting.current = true;
    setScanError("");
    setBusy(true);
    setProgress("Contacting scanner");
    setElapsed(0);
    setStartedAt(Date.now());
    try {
      submissionKey.current ??= createSubmissionId();
      const { jobId: id } = await startScanJob({
        dpi,
        mode,
        format: fmt,
        submissionId: submissionKey.current,
      });
      if (!/^[a-f0-9]{12}$/.test(id))
        throw new Error("The server returned an invalid scan job ID.");
      try {
        sessionStorage.setItem("scanJobId", id);
      } catch {}
      setJobId(id);
      submissionKey.current = null;
      setBlocked(false);
      setStuckJobId(null);
    } catch (err: any) {
      setBusy(false);
      if (err.status === 409) {
        if (/^[a-f0-9]{12}$/.test(err.jobId || "")) {
          try {
            sessionStorage.setItem("scanJobId", err.jobId);
          } catch {}
          setJobId(err.jobId);
          setBusy(true);
          setBlocked(false);
          submissionKey.current = null;
          push({
            kind: "info",
            title: "A scan is already running",
            desc: "Showing its progress. Wait for the result, or cancel it below.",
          });
        } else {
          setScanError(String(err.message || err).slice(0, 240));
        }
      } else {
        setScanError(String(err.message || err).slice(0, 240));
        push({
          kind: "error",
          title: "Couldn't start the scan",
          desc: String(err.message || err).slice(0, 240),
        });
      }
    } finally {
      submitting.current = false;
    }
  };

  const clearStuck = async () => {
    setClearing(true);
    try {
      if (stuckJobId) await cancelScanJob(stuckJobId);
      else await cancelAllScans();
      safeClearJob();
      setBlocked(false);
      setStuckJobId(null);
      push({
        kind: "info",
        title: "Cancellation requested",
        desc: "Allow the scanner to stop before trying again.",
      });
    } catch (err: any) {
      push({
        kind: "error",
        title: "Couldn't cancel the scan",
        desc: String(err.message || err).slice(0, 220),
      });
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
      push({
        kind: "error",
        title: "Couldn't cancel the scan",
        desc: String(err.message || err).slice(0, 220),
      });
    }
  };

  return (
    <div className="scan-workflow">
      <div className="workflow-heading">
        <div>
          <h2>Give paper a digital home.</h2>
          <p>A receipt, a letter, a page worth keeping.</p>
        </div>
        <span className="step-label">02 / SCAN</span>
      </div>
      <ScanFeedback
        resultName={resultName}
        onDismiss={() => setResultName(null)}
        error={scanError}
        storage={storage}
        busy={busy}
        scannerOk={scannerOk}
        scannerDetail={scannerDetail}
      />
      <form onSubmit={submit} style={{ marginTop: scannerOk || busy ? 0 : 12 }}>
        <div className="workspace-scan-guide">
          <span className="scan-page-art">
            <ScanLine size={45} strokeWidth={1.1} />
          </span>
          <span>
            <strong>Paper down. Possibilities up.</strong>
            <small>
              Place one A4 page face-down on the glass.
              <br />
              Align it with the corner mark and close the lid.
            </small>
          </span>
        </div>
        <div {...stylex.props(s.grid)}>
          <label {...stylex.props(ui.fieldLabel)}>
            <span>Colour</span>
            <select
              disabled={busy}
              {...stylex.props(ui.select)}
              value={mode}
              onChange={(e) => {
                submissionKey.current = null;
                setMode(e.target.value);
              }}
            >
              {modes.map((value) => (
                <option key={value} value={value}>
                  {MODE_LABELS[value] ?? "Black & white"}
                </option>
              ))}
            </select>
          </label>
          <label {...stylex.props(ui.fieldLabel)}>
            <span>Quality</span>
            <select
              disabled={busy}
              {...stylex.props(ui.select)}
              value={dpi}
              onChange={(e) => {
                submissionKey.current = null;
                setDpi(e.target.value);
              }}
            >
              {modeResolutions.map((value) => (
                <option key={value} value={value}>
                  {DPI_OPTIONS.find((o) => Number(o.value) === value)?.label ??
                    `${value} DPI`}
                </option>
              ))}
            </select>
          </label>
          <label {...stylex.props(ui.fieldLabel)}>
            <span>Format</span>
            <select
              disabled={busy}
              {...stylex.props(ui.select)}
              value={fmt}
              onChange={(e) => {
                submissionKey.current = null;
                setFmt(e.target.value);
              }}
            >
              {formats.map((value) => (
                <option key={value} value={value}>
                  {value.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
        </div>
        {dpi === "600" ? (
          <div {...stylex.props(ui.noteBox)} style={{ marginTop: 12 }}>
            600 dpi scans are large and slow. Best for photos — 300 dpi is
            plenty for documents.
          </div>
        ) : null}
        <p {...stylex.props(ui.help)} style={{ marginTop: 12 }}>
          Choose your settings. We’ll save the result to Saved scans.
        </p>
        {blocked ? (
          <div {...stylex.props(ui.noteBox)} style={{ marginTop: 12 }}>
            Another scan may be running. Cancel it only if you want to stop that
            scan.
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              {stuckJobId ? (
                <button
                  type="button"
                  {...stylex.props(ui.buttonQuiet)}
                  disabled={clearing || busy}
                  onClick={() => {
                    setScanError("");
                    setJobId(stuckJobId);
                    setBusy(true);
                    setBlocked(false);
                    setProgress("Reconnecting to your scan…");
                  }}
                >
                  Reconnect to scan
                </button>
              ) : null}
              <button
                type="button"
                {...stylex.props(ui.buttonQuiet)}
                disabled={clearing || busy}
                onClick={clearStuck}
              >
                {clearing ? "Clearing…" : "Cancel existing scan"}
              </button>
            </div>
          </div>
        ) : null}
        <div style={{ marginTop: 14 }}>
          <button
            {...stylex.props(
              ui.buttonPrimary,
              ui.buttonTeal,
              (busy || blocked || storageBlocked || !scannerOk) &&
                ui.buttonPrimaryDisabled,
            )}
            type="submit"
            disabled={
              busy || clearing || blocked || storageBlocked || !scannerOk
            }
            title={
              !scannerOk && !busy
                ? "Waiting for the scanner to be detected"
                : undefined
            }
          >
            {busy ? (
              <>
                <Loader2 size={16} className="spin" /> Scanning
                {elapsed > 0 ? ` · ${elapsed}s` : "…"}
              </>
            ) : (
              <>
                <ScanLine size={17} /> Scan & save <ArrowRight size={16} />
              </>
            )}
          </button>
          {busy ? (
            <div style={{ marginTop: 10 }}>
              <ProgressBar color={vars.teal as string} />
              <p {...stylex.props(s.stage)}>
                {progress || "Working"} · {elapsed}s
              </p>
              <button
                type="button"
                {...stylex.props(ui.buttonQuiet, ui.buttonDanger, s.cancel)}
                onClick={cancel}
                disabled={!jobId || cancelling}
              >
                <X size={13} /> Cancel scan
              </button>
            </div>
          ) : null}
        </div>
      </form>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
