import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Download,
  FileStack,
  FileText,
  Loader2,
  X,
} from "lucide-react";
import * as stylex from "@stylexjs/stylex";
import { combineScans } from "../lib/api";
import { s as ui } from "./ui";

export function CombineScans({
  files: initialFiles,
  onClose,
  onCreated,
}: {
  files: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [files, setFiles] = useState(initialFiles);
  const [name, setName] = useState("Combined scan");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ name: string; pages: number } | null>(
    null,
  );
  useEffect(() => {
    const node = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    node?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      node?.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);
  const move = (index: number, delta: number) => {
    setFiles((previous) => {
      const copy = [...previous];
      [copy[index], copy[index + delta]] = [copy[index + delta], copy[index]];
      return copy;
    });
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await combineScans(files, name);
      setResult(result);
      onCreated();
    } catch (error) {
      setError(
        (error as Error).message || "Could not create the PDF. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="combine-dialog"
      aria-labelledby="combine-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="dialog-heading">
        <span className="dialog-icon">
          <FileStack size={23} />
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label="Close PDF creator"
          disabled={busy}
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <h2 id="combine-title">
        {result ? "One neat document. Ready." : "Bring your pages together."}
      </h2>
      {result ? (
        <>
          <div className="operation-result">
            <Check size={20} />
            <div>
              <strong>{result.name}</strong>
              <p>{result.pages} pages · Your original scans are kept.</p>
            </div>
          </div>
          <a
            className="download-pdf"
            href={`/scans/${encodeURIComponent(result.name)}`}
          >
            <Download size={17} /> Download PDF
          </a>
          <button
            type="button"
            {...stylex.props(ui.buttonQuiet)}
            onClick={onClose}
          >
            Back to saved scans
          </button>
        </>
      ) : (
        <>
          <p className="dialog-description">
            Combine PDFs and images into one PDF. Put them in the order you
            need; your originals will stay in Saved scans.
          </p>
          <form onSubmit={submit}>
            <ol className="combine-files">
              {files.map((file, index) => (
                <li key={file}>
                  <span className="combine-number">{index + 1}</span>
                  <FileText size={16} />
                  <span className="combine-filename">{file}</span>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={busy || index === 0}
                    aria-label={`Move ${file} up`}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={busy || index === files.length - 1}
                    aria-label={`Move ${file} down`}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown size={15} />
                  </button>
                </li>
              ))}
            </ol>
            <label {...stylex.props(ui.fieldLabel)}>
              Document name
              <input
                {...stylex.props(ui.input)}
                aria-label="Document name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={100}
                disabled={busy}
              />
              <small>Saved as a PDF · Up to 100 pages and 128 MB</small>
            </label>
            {error ? (
              <p
                {...stylex.props(ui.errorBox)}
                role="alert"
                style={{ marginTop: 16 }}
              >
                {error}
              </p>
            ) : null}
            <button
              {...stylex.props(
                ui.buttonPrimary,
                busy && ui.buttonPrimaryDisabled,
              )}
              type="submit"
              disabled={busy || !name.trim()}
              style={{ marginTop: 20 }}
            >
              {busy ? (
                <>
                  <Loader2 size={16} className="spin" /> Creating your PDF…
                </>
              ) : (
                <>
                  <FileStack size={17} /> Create PDF
                </>
              )}
            </button>
          </form>
        </>
      )}
    </dialog>
  );
}
