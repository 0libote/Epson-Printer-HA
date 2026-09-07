import * as stylex from "@stylexjs/stylex";
import { vars } from "../styles/tokens.stylex";
import { useEffect, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { useToast } from "./Toast";
import { postClientSettings, postSetup } from "../lib/api";
import { s as ui, Card } from "./ui";

const s = stylex.create({
  stack: { display: "grid", gap: "14px" },
  cols: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
    "@media (max-width: 520px)": { gridTemplateColumns: "1fr" },
  },
  toggle: { display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", fontFamily: vars.fontSans, fontSize: "13.5px", color: vars.text },
  toggleSub: { display: "block", fontSize: "12.5px", color: vars.textTertiary, marginTop: "2px", fontWeight: 400 },
  uriRow: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
  code: {
    fontFamily: vars.fontMono,
    fontSize: "12px",
    color: vars.text,
    backgroundColor: vars.bgSunken,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.line,
    borderRadius: vars.radiusSm,
    padding: "8px 10px",
    overflowWrap: "anywhere",
    flex: 1,
    minWidth: "200px",
  },
  h3: { fontFamily: vars.fontSans, fontSize: "13.5px", fontWeight: 600, color: vars.text, marginTop: "18px" },
  p: { fontFamily: vars.fontSans, fontSize: "13px", lineHeight: 1.55, color: vars.textSecondary, marginTop: "6px" },
  copied: { color: vars.good },
});

function useCopy() {
  const { push } = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error("no clipboard");
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      push({ kind: "error", title: "Copy failed", desc: "Select the address and copy it manually." });
    }
  };
  return { copy, copied };
}

export function SharingSettings({ displayName, printerName, sharing, host, onSaved }: {
  displayName: string; printerName: string; sharing: boolean; host: string; onSaved: () => void;
}) {
  const { push } = useToast();
  const { copy, copied } = useCopy();
  const [nameEdit, setNameEdit] = useState(displayName);
  const [queueEdit, setQueueEdit] = useState(printerName);
  const [shareEdit, setShareEdit] = useState(sharing);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNameEdit(displayName);
    setQueueEdit(printerName);
    setShareEdit(sharing);
  }, [displayName, printerName, sharing]);

  const ippUri = `ipp://${host}:631/printers/${printerName}`;
  const httpUri = `http://${host}:631/printers/${printerName}`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameEdit.trim() || nameEdit.trim().length > 80) {
      push({ kind: "error", title: "Display name must be 1–80 characters." });
      return;
    }
    if (!/^[A-Za-z0-9._-]{1,127}$/.test(queueEdit.trim())) {
      push({ kind: "error", title: "Queue name may only contain letters, numbers, dot, dash and underscore." });
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("display_name", nameEdit.trim());
      fd.set("printer_name", queueEdit.trim());
      if (shareEdit) fd.set("share_printer", "on");
      await postClientSettings(fd);
      push({ kind: "success", title: "Sharing settings saved" });
      onSaved();
    } catch (err: any) {
      push({ kind: "error", title: "Couldn't save sharing settings", desc: String(err.message || err).slice(0, 220) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div {...stylex.props(ui.sectionHead)}>
        <h2 {...stylex.props(ui.sectionTitle)}>Network sharing</h2>
      </div>
      <form {...stylex.props(s.stack)} onSubmit={submit}>
        <div {...stylex.props(s.cols)}>
          <label {...stylex.props(ui.fieldLabel)}>
            Display name
            <input {...stylex.props(ui.input)} value={nameEdit} onChange={(e) => setNameEdit(e.target.value)} maxLength={80} required />
          </label>
          <label {...stylex.props(ui.fieldLabel)}>
            Queue name
            <input {...stylex.props(ui.input)} {...stylex.props(ui.mono)} value={queueEdit} onChange={(e) => setQueueEdit(e.target.value)} maxLength={127} required />
          </label>
        </div>
        <label {...stylex.props(s.toggle)}>
          <input
            type="checkbox"
            checked={shareEdit}
            onChange={(e) => setShareEdit(e.target.checked)}
            style={{ width: 17, height: 17, marginTop: 1, accentColor: vars.accent as string }}
          />
          <span>
            Share on the home network
            <span {...stylex.props(s.toggleSub)}>Lets phones and computers find the printer over IPP.</span>
          </span>
        </label>
        <div>
          <button {...stylex.props(ui.buttonQuiet)} type="submit" disabled={busy} style={busy ? { opacity: 0.5 } : undefined}>
            {busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Save settings
          </button>
        </div>
      </form>

      {sharing ? (
        <>
          <h3 {...stylex.props(s.h3)}>Connect a device</h3>
          <p {...stylex.props(s.p)}>
            On most devices, just add a printer and pick <strong>{displayName}</strong> from the list.
            If it doesn't appear, add it manually:
          </p>
          <div {...stylex.props(s.uriRow)} style={{ marginTop: 10 }}>
            <code {...stylex.props(s.code)}>{ippUri}</code>
            <button type="button" {...stylex.props(ui.buttonQuiet)} onClick={() => copy(ippUri)} aria-label="Copy printer address">
              {copied ? <Check size={13} {...stylex.props(s.copied)} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p {...stylex.props(s.p)} style={{ marginTop: 10 }}>
            Windows: Settings → Bluetooth &amp; devices → Printers &amp; scanners → Add device (manual address: {httpUri}).
            Mac: System Settings → Printers &amp; Scanners → Add Printer.
          </p>
        </>
      ) : (
        <div {...stylex.props(ui.noteBox)} style={{ marginTop: 14 }}>
          Sharing is off. Turn it on to let other devices on the network find this printer.
        </div>
      )}
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </Card>
  );
}

export function PrinterAddressSettings({ printerIp, onSaved }: { printerIp: string; onSaved: () => void }) {
  const { push } = useToast();
  const [ip, setIp] = useState(printerIp);
  const [busy, setBusy] = useState(false);

  useEffect(() => setIp(printerIp), [printerIp]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = ip.trim();
    if (!v) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("printer_ip", v);
      await postSetup(fd);
      push({ kind: "success", title: "Printer address updated", desc: v });
      onSaved();
    } catch (err: any) {
      push({ kind: "error", title: "Couldn't update the address", desc: String(err.message || err).slice(0, 220) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div {...stylex.props(ui.sectionHead)}>
        <h2 {...stylex.props(ui.sectionTitle)}>Printer address</h2>
      </div>
      <form {...stylex.props(s.stack)} onSubmit={submit}>
        <label {...stylex.props(ui.fieldLabel)}>
          Printer IP address
          <input {...stylex.props(ui.input)} {...stylex.props(ui.mono)} value={ip} onChange={(e) => setIp(e.target.value)} placeholder="192.168.1.50" inputMode="decimal" required />
        </label>
        <div>
          <button {...stylex.props(ui.buttonQuiet)} type="submit" disabled={busy} style={busy ? { opacity: 0.5 } : undefined}>
            {busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Save address
          </button>
        </div>
      </form>
    </Card>
  );
}
