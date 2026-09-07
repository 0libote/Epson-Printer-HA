import * as stylex from "@stylexjs/stylex";
import { vars } from "../styles/tokens.stylex";
import { useState } from "react";
import { ArrowRight, Loader2, Printer } from "lucide-react";
import { useToast } from "./Toast";
import { postSetup } from "../lib/api";
import { s as ui, ProgressBar } from "./ui";

const s = stylex.create({
  wrap: { maxWidth: "480px", margin: "72px auto 0", padding: "0 20px" },
  mark: {
    width: "48px",
    height: "48px",
    borderRadius: "14px",
    backgroundColor: vars.accentSoft,
    color: vars.accent,
    display: "grid",
    placeItems: "center",
    marginBottom: "20px",
  },
  h1: { fontFamily: vars.fontSans, fontSize: "24px", fontWeight: 650, letterSpacing: "-0.02em", color: vars.text },
  lede: { fontFamily: vars.fontSans, fontSize: "14px", lineHeight: 1.55, color: vars.textSecondary, marginTop: "8px" },
  form: { display: "grid", gap: "14px", marginTop: "24px" },
  tip: { fontFamily: vars.fontSans, fontSize: "12.5px", color: vars.textTertiary, lineHeight: 1.5 },
});

export function Setup({ onDone }: { onDone: () => void }) {
  const { push } = useToast();
  const [ip, setIp] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = ip.trim();
    const parts = v.split(".");
    if (parts.length !== 4 || parts.some((p) => !/^\d+$/.test(p) || Number(p) < 0 || Number(p) > 255)) {
      push({ kind: "error", title: "That doesn't look like an IPv4 address", desc: "Example: 192.168.1.50" });
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("printer_ip", v);
      await postSetup(fd);
      push({ kind: "success", title: "Printer connected", desc: `Configured at ${v}.` });
      onDone();
    } catch (err: any) {
      push({ kind: "error", title: "Couldn't connect to the printer", desc: String(err.message || err).slice(0, 220) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div {...stylex.props(s.wrap)}>
      <div {...stylex.props(ui.card, ui.cardPad)}>
        <div {...stylex.props(s.mark)}><Printer size={22} /></div>
        <h1 {...stylex.props(s.h1)}>Connect your printer</h1>
        <p {...stylex.props(s.lede)}>
          Enter the IP address from your router or the printer's network status sheet.
          Print Room handles the rest — no drivers needed on any device.
        </p>
        <form {...stylex.props(s.form)} onSubmit={submit}>
          <label {...stylex.props(ui.fieldLabel)}>
            Printer IP address
            <input
              {...stylex.props(ui.input)}
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              placeholder="192.168.1.50"
              inputMode="decimal"
              autoComplete="off"
              required
            />
          </label>
          {busy ? <ProgressBar /> : null}
          <button {...stylex.props(ui.buttonPrimary, busy && ui.buttonPrimaryDisabled)} type="submit" disabled={busy}>
            {busy ? <><Loader2 size={16} className="spin" /> Connecting…</> : <>Connect <ArrowRight size={16} /></>}
          </button>
          <p {...stylex.props(s.tip)}>Tip: reserve this address in your router's DHCP settings so it never changes.</p>
        </form>
      </div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
