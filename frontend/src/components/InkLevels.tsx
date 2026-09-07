import * as stylex from "@stylexjs/stylex";
import { vars } from "../styles/tokens.stylex";
import { Droplet, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useInk } from "../hooks/useStatus";
import { fetchInk, type InkStatus } from "../lib/api";
import { useToast } from "./Toast";
import { s as ui, Card, CardHeader, StatusDot } from "./ui";

const s = stylex.create({
  row: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "10px 0",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: vars.line,
  },
  lastRow: { borderBottomWidth: 0, borderBottomStyle: "none" },
  dot: { width: "14px", height: "14px", borderRadius: vars.radiusFull, flexShrink: 0, borderWidth: "1px", borderStyle: "solid", borderColor: "rgba(0,0,0,0.15)" },
  nameWrap: { flex: 1, minWidth: 0 },
  name: { fontFamily: vars.fontSans, fontSize: "13.5px", fontWeight: 600, color: vars.text },
  sub: { fontFamily: vars.fontMono, fontSize: "11px", color: vars.textTertiary, marginTop: "1px" },
  bar: { width: "120px", height: "8px", borderRadius: vars.radiusFull, backgroundColor: vars.bgSunken, overflow: "hidden", flexShrink: 0 },
  fill: { display: "block", height: "100%", borderRadius: vars.radiusFull },
  pct: { fontFamily: vars.fontMono, fontSize: "12px", color: vars.textSecondary, minWidth: "44px", textAlign: "right" },
  foot: { display: "flex", alignItems: "center", gap: "8px", marginTop: "12px", fontFamily: vars.fontMono, fontSize: "11px", color: vars.textTertiary },
  refresh: { marginLeft: "auto" },
});

function toneFor(state: string): "good" | "warn" | "bad" | "idle" {
  if (state === "ok") return "good";
  if (state === "low") return "warn";
  if (state === "empty") return "bad";
  return "idle";
}

export function InkLevels({ initial }: { initial?: InkStatus | null }) {
  const inkQ = useInk(true);
  const qc = useQueryClient();
  const { push } = useToast();
  const [refreshing, setRefreshing] = useState(false);

  // Prefer the live /api/ink poll; fall back to the snapshot piggy-backed on /api/status.
  const ink: InkStatus | undefined = (inkQ.data as InkStatus | undefined) ?? initial ?? undefined;

  const refresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await fetchInk(true);
      qc.setQueryData(["ink"], fresh);
      if (!fresh.ok) push({ kind: "info", title: "Ink check finished", desc: fresh.message.slice(0, 160) });
    } catch (err: any) {
      push({ kind: "error", title: "Couldn't refresh ink levels", desc: String(err.message || err).slice(0, 200) });
    } finally {
      setRefreshing(false);
    }
  };

  const carts = ink?.cartridges ?? [];
  const subtitle = ink
    ? ink.ok
      ? `via ${ink.source.toUpperCase()} · updated ${formatTime(ink.updated_at)}`
      : ink.message.slice(0, 90)
    : "Checking printer supplies…";

  return (
    <Card>
      <CardHeader
        icon={<Droplet size={18} />}
        title="Ink levels"
        sub={subtitle}
        tileBg={vars.accentSoft as string}
        tileColor={vars.accent as string}
        right={
          <button {...stylex.props(ui.buttonQuiet, s.refresh)} onClick={refresh} disabled={refreshing} aria-label="Refresh ink levels">
            <RefreshCw size={13} className={refreshing ? "spin" : undefined} /> {refreshing ? "Checking…" : "Refresh"}
          </button>
        }
      />
      {inkQ.isLoading && !ink ? (
        <div {...stylex.props(ui.statusRow)}><StatusDot tone="idle" /> Checking printer supplies…</div>
      ) : !carts.length ? (
        <p {...stylex.props(ui.help)}>No ink data yet. Make sure the printer is awake, then press Refresh.</p>
      ) : (
        <div>
          {carts.map((c, i) => (
            <div key={c.key} {...stylex.props(s.row, i === carts.length - 1 && s.lastRow)}>
              <span {...stylex.props(s.dot)} style={{ backgroundColor: c.color }} aria-hidden="true" />
              <div {...stylex.props(s.nameWrap)}>
                <div {...stylex.props(s.name)}>{c.name}</div>
                <div {...stylex.props(s.sub)}>{c.state === "unknown" ? "unknown" : c.state}</div>
              </div>
              <div {...stylex.props(s.bar)} role="progressbar" aria-valuenow={c.level ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={`${c.name} ink`}>
                <span
                  {...stylex.props(s.fill)}
                  style={{
                    width: `${c.level ?? 0}%`,
                    backgroundColor: c.state === "empty" ? (vars.bad as string) : c.state === "low" ? (vars.warn as string) : c.color,
                    opacity: c.level == null ? 0.25 : 1,
                  }}
                />
              </div>
              <span {...stylex.props(s.pct)}>{c.level == null ? "—" : `${c.level}%`}</span>
              <StatusDot tone={toneFor(c.state)} />
            </div>
          ))}
          <div {...stylex.props(s.foot)}>
            <span>{ink?.ok ? `Source: ${ink.source}` : "Printer may be asleep"}</span>
          </div>
        </div>
      )}
      <style>{`.spin{animation:spin 1.2s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </Card>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
