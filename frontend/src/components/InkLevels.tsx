import * as stylex from "@stylexjs/stylex";
import { vars } from "../styles/tokens.stylex";
import { Droplet, RefreshCw } from "lucide-react";
import { useState } from "react";
import { fetchInk, type InkStatus } from "../lib/api";
import { useToast } from "./Toast";
import { s as ui, CardHeader, StatusDot } from "./ui";

const s = stylex.create({
  grid: { display: "grid", gridTemplateColumns: "1fr", gap: "12px", "@media (max-width: 600px)": { gridTemplateColumns: "1fr", gap: "12px" } },
  row: { display: "grid", gridTemplateColumns: "10px 1fr auto", alignItems: "center", gap: "8px 10px" },
  dot: { width: "9px", height: "9px", borderRadius: vars.radiusFull },
  nameWrap: { minWidth: 0 },
  name: { fontSize: "13px", fontWeight: 500, color: vars.text },
  sub: { display: "none" },
  bar: { gridColumn: "2 / 4", height: "5px", borderRadius: vars.radiusFull, backgroundColor: vars.line, overflow: "hidden" },
  fill: { display: "block", height: "100%", borderRadius: vars.radiusFull },
  pct: { gridColumn: "3", gridRow: "1", fontSize: "12px", fontWeight: 600, color: vars.textSecondary },
  refresh: { marginLeft: "auto" },
});

export function InkLevels({ initial, stale = false }: { initial?: InkStatus | null; stale?: boolean }) {
  const [manual, setManual] = useState<InkStatus | null>(null);
  const { push } = useToast();
  const [refreshing, setRefreshing] = useState(false);

  const ink = manual && (!initial || Date.parse(manual.updated_at) > (Date.parse(initial.updated_at) || 0)) ? manual : initial;

  const refresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await fetchInk(true);
      if (fresh.ok || !ink?.cartridges.some(c => c.level !== null)) setManual(fresh);
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
      ? `${stale ? "Last known · " : ""}Supplies updated ${formatTime(ink.updated_at)}`
      : ink.message.slice(0, 90)
    : "Checking printer supplies…";

  return (
    <div className="supplies-panel">
      <CardHeader
        icon={<Droplet size={16} />}
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
      {!ink?.updated_at ? (
        <div {...stylex.props(ui.statusRow)}><StatusDot tone="idle" /> Checking printer supplies…</div>
      ) : !carts.length ? (
        <p {...stylex.props(ui.help)}>No ink data yet. Make sure the printer is awake, then press Refresh.</p>
      ) : (
        <div {...stylex.props(s.grid)}>
          {carts.map((c) => (
            <div key={c.key} {...stylex.props(s.row)}>
              <span {...stylex.props(s.dot)} style={{ backgroundColor: c.color }} aria-hidden="true" />
              <div {...stylex.props(s.nameWrap)}>
                <div {...stylex.props(s.name)}>{c.name}</div>
                <div {...stylex.props(s.sub)}>{c.state === "unknown" ? "unknown" : c.state}</div>
              </div>
              <div {...stylex.props(s.bar)} title={c.state === "low" ? "Ink is low" : c.state === "empty" ? "Cartridge is empty" : undefined} role="progressbar" aria-valuenow={c.level ?? undefined} aria-valuetext={c.level == null ? "Unknown" : `${c.level}%`} aria-valuemin={0} aria-valuemax={100} aria-label={`${c.name} ink`}>
                <span
                  {...stylex.props(s.fill)}
                  style={{
                    width: `${c.level ?? 0}%`,
                    backgroundColor: c.state === "empty" ? (vars.bad as string) : c.state === "low" ? (vars.warn as string) : c.color,
                    opacity: c.level == null ? 0.25 : 1,
                  }}
                />
              </div>
              <span {...stylex.props(s.pct)}>{c.level == null ? "Unknown" : `${c.level}%${c.state === "low" ? " · Low" : c.state === "empty" ? " · Empty" : ""}`}</span>

            </div>
          ))}
        </div>
      )}
      <style>{`.spin{animation:spin 1.2s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
