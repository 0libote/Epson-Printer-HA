import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  FileText,
  Image,
  Loader2,
  Printer,
  Upload,
  X,
} from "lucide-react";
import { postPrint, type PrintResponse } from "../lib/api";
import { s as ui, ProgressBar } from "./ui";

const ACCEPT = [".pdf", ".png", ".jpg", ".jpeg", ".txt"];
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

export function PrintCard({
  onPrinted,
  maxMb,
  offline = false,
}: {
  onPrinted: () => void;
  maxMb?: number;
  offline?: boolean;
}) {
  const max = maxMb && Number.isFinite(maxMb) && maxMb >= 1 ? maxMb : 128;
  const [file, setFile] = useState<File | null>(null);
  const [options, setOptions] = useState<Options>(savedOptions);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<
    (PrintResponse & { name: string }) | null
  >(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [preview, setPreview] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const submissionId = useRef<string | null>(null);
  const submitting = useRef(false);
  const dragDepth = useRef(0);
  const isPdf = file?.name.toLowerCase().endsWith(".pdf");
  const isImage = file && /\.(png|jpe?g)$/i.test(file.name);

  useEffect(() => {
    if (!file || (!isPdf && !isImage)) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isPdf, isImage]);
  const change = <K extends keyof Options>(key: K, value: Options[K]) => {
    setOptions((previous) => ({ ...previous, [key]: value }));
    submissionId.current = null;
    setError("");
  };
  const pick = (picked: File | null) => {
    if (submitting.current || !picked) return;
    setError("");
    const ext = "." + picked.name.split(".").pop()?.toLowerCase();
    if (!ACCEPT.includes(ext)) {
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
    setPreview(false);
    setOptions((previous) => ({ ...previous, pages: "" }));
    submissionId.current = null;
    if (fileRef.current) fileRef.current.value = "";
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
    submissionId.current ??=
      globalThis.crypto?.randomUUID?.() ||
      `print_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("submission_id", submissionId.current);
      for (const [key, value] of Object.entries(options))
        form.set(
          key,
          key === "grayscale" ? (value ? "on" : "off") : String(value),
        );
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
      <div className="workflow-heading">
        <div>
          <h2>What would you like to print?</h2>
          <p>Choose a file. We’ll take care of the rest.</p>
        </div>
        <span className="step-label">01 / PRINT</span>
      </div>
      {receipt ? (
        <div className="operation-result" role="status">
          <span className="result-icon">
            <Check size={20} />
          </span>
          <div>
            <strong>Added to your print queue</strong>
            <p>{receipt.name}</p>
            <small>
              {receipt.job_id ? `Job ${receipt.job_id} · ` : ""}Follow its
              progress in the queue below.
            </small>
            <a href="#history">
              View print history <ArrowRight size={13} />
            </a>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Dismiss print confirmation"
            onClick={() => setReceipt(null)}
          >
            <X size={16} />
          </button>
        </div>
      ) : null}
      <form onSubmit={submit}>
        <input
          ref={fileRef}
          className="visually-hidden"
          type="file"
          disabled={busy}
          accept={ACCEPT.join(",")}
          onChange={(event) => pick(event.target.files?.[0] || null)}
          tabIndex={-1}
          aria-label="File to print"
        />
        <button
          type="button"
          className={`document-drop ${dragOver ? "is-dragging" : ""} ${file ? "has-file" : ""}`}
          disabled={busy}
          aria-label="Choose a file to print"
          onClick={() => fileRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault();
            dragDepth.current++;
            setDragOver(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => {
            if (--dragDepth.current <= 0) {
              dragDepth.current = 0;
              setDragOver(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            dragDepth.current = 0;
            setDragOver(false);
            if (event.dataTransfer.files.length > 1)
              setError(
                "Choose one document at a time so each has its own print settings.",
              );
            else pick(event.dataTransfer.files[0]);
          }}
        >
          <span className="document-drop-art">
            {file ? (
              <FileText size={30} strokeWidth={1.4} />
            ) : (
              <Upload size={28} strokeWidth={1.4} />
            )}
          </span>
          <strong>
            {dragOver
              ? "Drop your document here"
              : file
                ? file.name
                : "A little drag. A little drop."}
          </strong>
          <span>
            {file ? (
              `${(file.size / 1024 / 1024).toFixed(2)} MB · Click to choose a different file`
            ) : (
              <>
                Or <u>browse files</u> on your device
              </>
            )}
          </span>
          <small>
            PDF, JPG, PNG, TXT <span>·</span> Up to {max} MB
          </small>
        </button>
        {file ? (
          <div className="file-toolbar">
            <span>
              <FileText size={14} /> Document selected
            </span>
            <div>
              {previewUrl ? (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setPreview((value) => !value)}
                >
                  {preview ? "Close preview" : "Preview file"}
                </button>
              ) : null}
              <button
                className="text-button"
                type="button"
                disabled={busy}
                onClick={() => {
                  setFile(null);
                  setError("");
                  submissionId.current = null;
                }}
              >
                Remove
              </button>
            </div>
          </div>
        ) : null}
        {preview && previewUrl ? (
          <div className="document-preview">
            {isImage ? (
              <img src={previewUrl} alt={`Preview of ${file?.name}`} />
            ) : (
              <iframe src={previewUrl} title={`Preview of ${file?.name}`} />
            )}
            <p>
              Original file preview. Paper and scaling settings apply when
              printed.
            </p>
          </div>
        ) : null}
        <fieldset className="print-options" disabled={busy}>
          <legend className="visually-hidden">Print settings</legend>
          <div className="option-grid">
            <label {...stylex.props(ui.fieldLabel)}>
              Copies
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
              Paper size
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
              Colour
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
              Layout & page selection <span>Optional</span>
            </summary>
            <div className="option-grid">
              <label {...stylex.props(ui.fieldLabel)}>
                Orientation
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
                Scaling
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
                Pages
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
              <ArrowRight size={16} />
            </>
          )}
        </button>
        {busy ? (
          <div className="upload-progress">
            <ProgressBar />
            <p>Keep this page open while your file uploads.</p>
          </div>
        ) : null}
        <p className="workflow-footnote">
          <Image size={13} /> Your file is removed after it leaves the queue.
        </p>
      </form>
    </div>
  );
}
