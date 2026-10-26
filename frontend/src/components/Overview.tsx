import { useState } from "react";
import { Ban, FileText, Loader2, TriangleAlert, WifiOff } from "lucide-react";
import { useToast } from "./Toast";
import { cancelPrintJob, resumePrintQueue } from "../lib/api";
export type QueueJob = { id: string; owner: string; size: string; raw: string };
export type PrinterNetwork = {
  serverIps: string[];
  sameSubnet: boolean | null;
  hint: string;
} | null;

export function PrinterUnreachableBanner({
  network,
  queuedJobs,
  recoveryMessage,
}: {
  network: PrinterNetwork;
  queuedJobs: number;
  recoveryMessage?: string;
}) {
  return (
    <div className="connection-notice" role="status">
      <WifiOff size={20} />
      <div>
        <strong>Your printer is offline</strong>
        <p>
          Turn it on and check its Wi-Fi connection.
          {queuedJobs > 0
            ? ` Your ${queuedJobs === 1 ? "waiting job is" : "waiting jobs are"} kept in the queue.`
            : ""}
        </p>
        <a href="#settings">Check the connection in Settings</a>
        {recoveryMessage || network?.hint ? (
          <details>
            <summary>Connection details</summary>
            <p>{recoveryMessage || network?.hint}</p>
          </details>
        ) : null}
      </div>
    </div>
  );
}

export function Queue({
  jobs,
  onChanged,
}: {
  jobs: QueueJob[];
  onChanged: () => void;
}) {
  const { push } = useToast();
  const [pending, setPending] = useState<Set<string>>(new Set());
  const cancel = async (id: string) => {
    if (pending.has(id)) return;
    setPending((previous) => new Set(previous).add(id));
    try {
      await cancelPrintJob(id);
      push({ kind: "success", title: "Job cancelled", desc: id });
      onChanged();
    } catch (error) {
      push({
        kind: "error",
        title: "Couldn’t cancel the job",
        desc: (error as Error).message.slice(0, 200),
      });
    } finally {
      setPending((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    }
  };
  return (
    <div className="queue-jobs">
      {jobs.map((job) => (
        <div className="queue-job" key={job.id}>
          <span className="queue-job-icon">
            <FileText size={18} />
          </span>
          <div>
            <strong>{job.id}</strong>
            <small>
              {job.owner || "Print job"}
              {job.size ? ` · ${job.size}` : ""}
            </small>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => cancel(job.id)}
            disabled={pending.has(job.id)}
            aria-label={`Cancel ${job.id}`}
            title="Cancel job"
          >
            {pending.has(job.id) ? (
              <Loader2 className="spin" size={15} />
            ) : (
              <Ban size={15} />
            )}
          </button>
        </div>
      ))}
    </div>
  );
}

export function QueueAttention({ onChanged }: { onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const resume = async () => {
    setBusy(true);
    setError("");
    try {
      await resumePrintQueue();
      onChanged();
    } catch (error) {
      setError((error as Error).message || "Could not resume the queue.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="queue-attention" role="alert">
      <TriangleAlert size={20} />
      <div>
        <strong>Printing is paused</strong>
        <p>
          Check the paper tray and clear any printer error, then resume your
          waiting jobs.
        </p>
        {error ? <p>{error}</p> : null}
      </div>
      <button
        className="button-secondary"
        type="button"
        disabled={busy}
        onClick={resume}
      >
        {busy ? <Loader2 size={15} className="spin" /> : null}
        {busy ? "Resuming…" : "Resume printing"}
      </button>
    </div>
  );
}
