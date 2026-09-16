import * as stylex from "@stylexjs/stylex";
import { vars } from "../styles/tokens.stylex";
import { useRef, useState } from "react";
import { FileText, Loader2, Printer, Upload, X } from "lucide-react";
import { useToast } from "./Toast";
import { postPrint } from "../lib/api";
import { s as ui, Card, CardHeader, ProgressBar } from "./ui";

const FALLBACK_MAX_MB = 128;

const s = stylex.create({
  drop: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "16px",
    borderRadius: vars.radiusMd,
    borderWidth: "1.5px",
    borderStyle: "dashed",
    borderColor: vars.lineStrong,
    backgroundColor: vars.bgSunken,
    cursor: "pointer",
    width: "100%",
    textAlign: "left",
    transition: "border-color .15s, background-color .15s",
  },
  dropActive: { borderColor: vars.accent, backgroundColor: vars.accentSoft },
  dropIcon: {
    width: "36px",
    height: "36px",
    borderRadius: "10px",
    backgroundColor: vars.panel,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.line,
    display: "grid",
    placeItems: "center",
    color: vars.textSecondary,
    flexShrink: 0,
  },
  dropText: { fontFamily: vars.fontSans, fontSize: "13.5px", fontWeight: 550, color: vars.text },
  dropHint: { fontFamily: vars.fontSans, fontSize: "12px", color: vars.textTertiary, marginTop: "2px" },
  fileInput: { position: "absolute", width: "1px", height: "1px", opacity: 0, pointerEvents: "none" },
  row: { display: "flex", gap: "12px", marginTop: "14px" },
  check: { display: "flex", alignItems: "center", gap: "8px", fontFamily: vars.fontSans, fontSize: "13.5px", color: vars.textSecondary, cursor: "pointer", marginTop: "14px" },
  chosen: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginTop: "12px",
    padding: "10px 8px 10px 12px",
    borderRadius: vars.radiusSm,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.line,
    backgroundColor: vars.panel,
    fontFamily: vars.fontSans,
    fontSize: "13px",
    color: vars.text,
  },
  chosenName: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  chosenMeta: { fontFamily: vars.fontMono, fontSize: "11.5px", color: vars.textTertiary, flexShrink: 0 },
  iconBtn: {
    borderWidth: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    color: vars.textTertiary,
    cursor: "pointer",
    padding: "6px",
    borderRadius: "6px",
    display: "grid",
    placeItems: "center",
  },
  stage: { fontFamily: vars.fontSans, fontSize: "12.5px", color: vars.textSecondary, marginTop: "10px" },
});

const ACCEPT = [".pdf", ".png", ".jpg", ".jpeg", ".txt"];

export function PrintCard({ onPrinted, maxMb }: { onPrinted: () => void; maxMb?: number }) {
  const { push } = useToast();
  const maxMbEffective = typeof maxMb === "number" && Number.isFinite(maxMb) && maxMb >= 1 ? Math.floor(maxMb) : FALLBACK_MAX_MB;
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [copiesText, setCopiesText] = useState("1");
  const [grayscale, setGrayscale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const copies = Number(copiesText);

  const pick = (f: File | null) => {
    if (busy) return;
    setError(null);
    if (!f) { setFile(null); return; }
    const ext = "." + (f.name.split(".").pop() || "").toLowerCase();
    if (!ACCEPT.includes(ext)) { setError("Supported files: PDF, PNG, JPG and TXT."); setFile(null); return; }
    if (f.size === 0) { setError("The selected file is empty."); setFile(null); return; }
    if (f.size > maxMbEffective * 1024 * 1024) { setError(`That file is too large. The limit is ${maxMbEffective} MB.`); setFile(null); return; }
    setFile(f);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!file) { setError("Choose a file first."); return; }
    if (!/^\d+$/.test(copiesText.trim()) || !Number.isInteger(copies) || copies < 1 || copies > 99) {
      setError("Copies must be a whole number between 1 and 99.");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("copies", String(copies));
      if (grayscale) fd.set("grayscale", "on");
      await postPrint(fd);
      push({ kind: "success", title: "Sent to printer", desc: `${file.name} · ${copies} ${copies === 1 ? "copy" : "copies"}` });
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      onPrinted();
    } catch (err: any) {
      const msg = String(err.message || err).slice(0, 260);
      setError(msg);
      push({ kind: "error", title: "Print failed", desc: msg.slice(0, 200) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        icon={<Printer size={18} />}
        tileBg={vars.accentSoft as string}
        tileColor={vars.accent as string}
        title="Print"
        sub="PDF, images or plain text"
      />
      <form onSubmit={submit}>
          <input
            ref={fileRef}
            {...stylex.props(s.fileInput)}
            type="file"
            disabled={busy}
            accept={ACCEPT.join(",")}
            onChange={(e) => pick(e.target.files?.[0] || null)}
            tabIndex={-1}
          />
        <button
          {...stylex.props(s.drop, dragOver && s.dropActive)}
          type="button"
          disabled={busy}
          aria-label="Choose a file to print"
          onClick={() => fileRef.current?.click()}
          onDragEnter={(e) => { e.preventDefault(); dragDepth.current++; setDragOver(true); }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragOver(false); }}
          onDrop={(e) => { e.preventDefault(); dragDepth.current = 0; setDragOver(false); const f = e.dataTransfer.files[0]; if (f) pick(f); }}
        >
          <span {...stylex.props(s.dropIcon)}><Upload size={17} /></span>
          <span>
            <span {...stylex.props(s.dropText)}>{dragOver ? "Drop it" : "Choose a file or drag it here"}</span>
            <br />
            <span {...stylex.props(s.dropHint)}>PDF · PNG · JPG · TXT · up to {maxMbEffective} MB</span>
          </span>
        </button>

        {file ? (
          <div {...stylex.props(s.chosen)}>
            <FileText size={15} style={{ flexShrink: 0, color: vars.textTertiary as string }} />
            <span {...stylex.props(s.chosenName)}>{file.name}</span>
            <span {...stylex.props(s.chosenMeta)}>{(file.size / 1024).toFixed(0)} KB</span>
            <button type="button" {...stylex.props(s.iconBtn)} disabled={busy} aria-label="Remove file" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }}>
              <X size={14} />
            </button>
          </div>
        ) : null}

        {error ? <div {...stylex.props(ui.errorBox)} style={{ marginTop: 12 }} role="alert">{error}</div> : null}

        <div {...stylex.props(s.row)}>
          <label {...stylex.props(ui.fieldLabel)} style={{ width: 110 }}>
            Copies
            <input
              {...stylex.props(ui.input)}
              type="number"
              disabled={busy}
              min={1}
              max={99}
              value={copiesText}
              onChange={(e) => setCopiesText(e.target.value)}
            />
          </label>
          <label {...stylex.props(s.check)}>
            <input type="checkbox" disabled={busy} checked={grayscale} onChange={(e) => setGrayscale(e.target.checked)} style={{ width: 16, height: 16, accentColor: vars.accent as string }} />
            <span>Black &amp; white</span>
          </label>
        </div>

        <div style={{ marginTop: 16 }}>
          <button {...stylex.props(ui.buttonPrimary, busy && ui.buttonPrimaryDisabled)} type="submit" disabled={busy}>
            {busy ? <><Loader2 size={16} className="spin" /> Sending…</> : "Print"}
          </button>
          {busy ? <div style={{ marginTop: 10 }}><ProgressBar /><p {...stylex.props(s.stage)}>Uploading and queueing…</p></div> : null}
        </div>
      </form>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </Card>
  );
}
