import * as stylex from "@stylexjs/stylex";
import { useRef, useState } from "react";
import { ArrowRight, FileText, Loader2, Printer } from "lucide-react";
import { postPrint, type PrintResponse } from "../lib/api";
import { createSubmissionId } from "../lib/submission-id";
import { s as ui, ProgressBar } from "./ui";
import { OperationResult } from "./OperationResult";
import { PrintFilePicker, PRINT_FILE_TYPES } from "./PrintFilePicker";

const defaults = {
  copies: "1",
  grayscale: false,
  paper: "A4",
  orientation: "portrait",
  scaling: "fit",
  pages: "",
};
type Options = typeof defaults;
function savedOptions(): Options {
  try {
    const saved = JSON.parse(
      localStorage.getItem("print-room-options") || "null",
    );
    if (saved && ["A4", "Letter"].includes(saved.paper))
      return {
        ...defaults,
        paper: saved.paper,
        grayscale: saved.grayscale === true,
      };
  } catch {}
  return defaults;
}

function printOptionValue(key: string, value: string | boolean) {
  if (key === "grayscale") return value ? "on" : "off";
  return String(value);
}

export function PrintCard({
  onPrinted,
  maxMb,
  offline = false,
}: Readonly<{
  onPrinted: () => void;
  maxMb?: number;
  offline?: boolean;
}>) {
  const max = maxMb && Number.isFinite(maxMb) && maxMb >= 1 ? maxMb : 128;
  const [file, setFile] = useState<File | null>(null);
  const [options, setOptions] = useState<Options>(savedOptions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<
    (PrintResponse & { name: string }) | null
  >(null);
  const submissionId = useRef<string | null>(null);
  const submitting = useRef(false);
  const isPdf = file?.name.toLowerCase().endsWith(".pdf");
  const change = <K extends keyof Options>(key: K, value: Options[K]) => {
    setOptions((previous) => ({ ...previous, [key]: value }));
    submissionId.current = null;
    setError("");
  };
  const pick = (picked: File | null) => {
    if (submitting.current || !picked) return;
    setError("");
    const ext = "." + picked.name.split(".").pop()?.toLowerCase();
    if (!PRINT_FILE_TYPES.includes(ext)) {
      setError("Choose a PDF, PNG, JPG or plain text file.");
      return;
    }
    if (!picked.size) {
      setError("That file is empty. Choose another document.");
      return;
    }
    if (picked.size > max * 1024 * 1024) {
      setError(`Choose a file smaller than ${max} MB.`);
      return;
    }
    setFile(picked);
    setReceipt(null);
    setOptions((previous) => ({ ...previous, pages: "" }));
    submissionId.current = null;
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file || submitting.current) return;
    const copies = Number(options.copies);
    if (!/^\d+$/.test(options.copies) || copies < 1 || copies > 99) {
      setError("Choose a whole number of copies from 1 to 99.");
      return;
    }
    if (
      options.pages &&
      !/^[1-9]\d*(?:-[1-9]\d*)?(?:\s*,\s*[1-9]\d*(?:-[1-9]\d*)?)*$/.test(
        options.pages.trim(),
      )
    ) {
      setError("Enter pages like 1-3, 5 or leave blank for all pages.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    // The same key survives a failed request. Retrying cannot print twice.
    try {
      submissionId.current ??= createSubmissionId();
      const form = new FormData();
      form.set("file", file);
      form.set("submission_id", submissionId.current);
      for (const [key, value] of Object.entries(options))
        form.set(key, printOptionValue(key, value));
      const result = await postPrint(form);
      setReceipt({ ...result, name: file.name });
      try {
        localStorage.setItem(
          "print-room-options",
          JSON.stringify({
            paper: options.paper,
            grayscale: options.grayscale,
          }),
        );
      } catch {}
      setFile(null);
      submissionId.current = null;
      onPrinted();
    } catch (error) {
      if ((error as Error & { retrySafe?: boolean }).retrySafe)
        submissionId.current = null;
      setError(`${(error as Error).message || "Connection interrupted."}`);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="print-workflow">
      <div className="workflow-section-heading"><h2>Your document</h2><span>PDF, images or text</span></div>
      {receipt ? (
        <OperationResult
          title="Added to your print queue"
          description={receipt.name}
          dismissLabel="Dismiss print confirmation"
          onDismiss={() => setReceipt(null)}
        >
          <small>
            {receipt.job_id ? `Job ${receipt.job_id} · ` : ""}Track its
            progress in the print queue.
          </small>
          <a href="#history">
            View print history <ArrowRight size={13} />
          </a>
        </OperationResult>
      ) : null}
      <form onSubmit={submit}>
        <PrintFilePicker
          file={file}
          max={max}
          busy={busy}
          onPick={pick}
          onError={setError}
          onRemove={() => {
            setFile(null);
            setError("");
            submissionId.current = null;
          }}
        />
        <fieldset className="print-options" disabled={busy}>
          <legend className="visually-hidden">Print settings</legend>
          <h2 className="form-section-title">Print settings</h2>
          <div className="option-grid">
            <label {...stylex.props(ui.fieldLabel)}>
              <span>Copies</span>
              <input
                {...stylex.props(ui.input)}
                type="number"
                min={1}
                max={99}
                required
                value={options.copies}
                onChange={(event) => change("copies", event.target.value)}
              />
            </label>
            <label {...stylex.props(ui.fieldLabel)}>
              <span>Paper size</span>
              <select
                {...stylex.props(ui.select)}
                value={options.paper}
                onChange={(event) => change("paper", event.target.value)}
              >
                <option value="A4">A4</option>
                <option value="Letter">US Letter</option>
              </select>
            </label>
            <label {...stylex.props(ui.fieldLabel)}>
              <span>Colour</span>
              <select
                {...stylex.props(ui.select)}
                value={options.grayscale ? "mono" : "colour"}
                onChange={(event) =>
                  change("grayscale", event.target.value === "mono")
                }
              >
                <option value="colour">Full colour</option>
                <option value="mono">Black & white</option>
              </select>
            </label>
          </div>
          <details className="more-options">
            <summary>
              Page layout <span>Orientation, scale & pages</span>
            </summary>
            <div className="option-grid">
              <label {...stylex.props(ui.fieldLabel)}>
                <span>Orientation</span>
                <select
                  {...stylex.props(ui.select)}
                  value={options.orientation}
                  onChange={(event) =>
                    change("orientation", event.target.value)
                  }
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </label>
              <label {...stylex.props(ui.fieldLabel)}>
                <span>Scaling</span>
                <select
                  {...stylex.props(ui.select)}
                  value={options.scaling}
                  onChange={(event) => change("scaling", event.target.value)}
                >
                  <option value="fit">Fit to page</option>
                  <option value="actual">Actual size</option>
                </select>
              </label>
              <label {...stylex.props(ui.fieldLabel)}>
                <span>Pages</span>
                <input
                  {...stylex.props(ui.input)}
                  value={options.pages}
                  disabled={!isPdf}
                  placeholder={isPdf ? "All, e.g. 1-3, 5" : "All pages"}
                  onChange={(event) => change("pages", event.target.value)}
                  aria-describedby="pages-help"
                />
              </label>
            </div>
            <p id="pages-help">
              Page selection is available for PDFs. Printing is single-sided.
            </p>
          </details>
        </fieldset>
        {offline ? (
          <p className="inline-notice">
            The printer is offline. Your document will wait in the queue until
            it reconnects.
          </p>
        ) : null}
        {error ? (
          <div {...stylex.props(ui.errorBox)} role="alert">
            {error}
            <a href="#history">Check history</a>
          </div>
        ) : null}
        <div className="workflow-action-bar">
          <p><FileText size={14} /> {file ? `${options.copies || "1"} ${options.copies === "1" ? "copy" : "copies"} on ${options.paper === "Letter" ? "US Letter" : "A4"}` : "Choose a file to continue"}</p>
        <button
          {...stylex.props(
            ui.buttonPrimary,
            (!file || busy) && ui.buttonPrimaryDisabled,
          )}
          className={`${stylex.props(ui.buttonPrimary, (!file || busy) && ui.buttonPrimaryDisabled).className} workflow-submit`}
          type="submit"
          disabled={!file || busy}
        >
          {busy ? (
            <>
              <Loader2 size={17} className="spin" /> Sending to your printer…
            </>
          ) : (
            <>
              <Printer size={17} />{" "}
              {offline ? "Add to print queue" : "Print document"}
            </>
          )}
        </button>
        </div>
        {busy ? (
          <div className="upload-progress">
            <ProgressBar />
            <p>Keep this page open while your file uploads.</p>
          </div>
        ) : null}
        <p className="workflow-footnote">
          Your document is removed after it leaves the print queue.
        </p>
      </form>
    </div>
  );
}
