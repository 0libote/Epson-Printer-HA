import * as stylex from "@stylexjs/stylex";
import { vars } from "../styles/tokens.stylex";
import { Ban, Loader2 } from "lucide-react";
import { useToast } from "./Toast";
import { cancelPrintJob } from "../lib/api";
import { s as ui, Card, StatusDot, safeLabel } from "./ui";

export type QueueJob = { id: string; owner: string; size: string; raw: string };

const s = stylex.create({
  strip: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "1px",
    backgroundColor: vars.line,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.line,
    borderRadius: vars.radiusLg,
    overflow: "hidden",
    "@media (max-width: 560px)": { gridTemplateColumns: "1fr" },
  },
  cell: {
    backgroundColor: vars.panel,
    padding: "14px 16px",
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

export function StatusStrip({ printerOk, printerState, printerDetail, scannerOk, scannerDetail, queueCount }: {
  printerOk: boolean; printerState: string; printerDetail: string;
  scannerOk: boolean; scannerDetail: string; queueCount: number;
}) {
  return (
    <div {...stylex.props(s.strip)} aria-label="Device status">
      <div {...stylex.props(s.cell)}>
        <span {...stylex.props(s.label)}><StatusDot tone={printerOk ? "good" : "bad"} /> Printer</span>
        <span {...stylex.props(s.value)}>{safeLabel(printerState)}</span>
        <span {...stylex.props(s.detail)} title={printerDetail}>{printerDetail || "—"}</span>
      </div>
      <div {...stylex.props(s.cell)}>
        <span {...stylex.props(s.label)}><StatusDot tone={scannerOk ? "good" : "warn"} /> Scanner</span>
        <span {...stylex.props(s.value)}>{scannerOk ? "Ready" : "Starting"}</span>
        <span {...stylex.props(s.detail)} title={scannerDetail}>{scannerDetail || "—"}</span>
      </div>
      <div {...stylex.props(s.cell)}>
        <span {...stylex.props(s.label)}><StatusDot tone={queueCount > 0 ? "warn" : "good"} /> Queue</span>
        <span {...stylex.props(s.value)}>{queueCount} {queueCount === 1 ? "job" : "jobs"}</span>
        <span {...stylex.props(s.detail)}>{queueCount > 0 ? "Printing" : "Empty"}</span>
      </div>
    </div>
  );
}

export function Queue({ jobs, onChanged }: { jobs: QueueJob[]; onChanged: () => void }) {
  const { push } = useToast();

  if (jobs.length === 0) return null;

  const cancel = async (id: string) => {
    try {
      await cancelPrintJob(id);
      push({ kind: "success", title: "Job cancelled", desc: id });
      onChanged();
    } catch (err: any) {
      push({ kind: "error", title: "Couldn't cancel the job", desc: String(err.message || err).slice(0, 200) });
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
            <button {...stylex.props(ui.buttonQuiet, ui.buttonDanger)} onClick={() => cancel(j.id)}>
              <Ban size={13} /> Cancel
            </button>
          </div>
        ))}
      </div>
      <style>{`.spin{animation:spin 1.4s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </Card>
  );
}

