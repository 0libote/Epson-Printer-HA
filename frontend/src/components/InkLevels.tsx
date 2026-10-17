import * as stylex from "@stylexjs/stylex";
import { vars } from "../styles/tokens.stylex";
import { Droplet, RefreshCw } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { fetchInk, type InkStatus } from "../lib/api";
import { useToast } from "./Toast";
import { s as ui, CardHeader, StatusDot } from "./ui";

const s = stylex.create({
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: "12px",
    "@media (max-width: 600px)": { gridTemplateColumns: "1fr", gap: "12px" },
  },
  row: {
    display: "grid",
    gridTemplateColumns: "10px 1fr auto",
    alignItems: "center",
    gap: "8px 10px",
  },
  dot: { width: "9px", height: "9px", borderRadius: vars.radiusFull },
  nameWrap: { minWidth: 0 },
  name: { fontSize: "13px", fontWeight: 500, color: vars.text },
  sub: { display: "none" },
  bar: {
    gridColumn: "2 / 4",
    height: "5px",
    borderRadius: vars.radiusFull,
    backgroundColor: vars.line,
    overflow: "hidden",
  },
  pct: {
    gridColumn: "3",
    gridRow: "1",
    fontSize: "12px",
    fontWeight: 600,
    color: vars.textSecondary,
  },
  refresh: { marginLeft: "auto" },
});

export function InkLevels({
  initial,
  stale = false,
}: Readonly<{
  initial?: InkStatus | null;
  stale?: boolean;
}>) {
  const [manual, setManual] = useState<InkStatus | null>(null);
  const { push } = useToast();
  const [refreshing, setRefreshing] = useState(false);

  const ink =
    manual &&
    (!initial ||
      Date.parse(manual.updated_at) > (Date.parse(initial.updated_at) || 0))
      ? manual
      : initial;

  const refresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await fetchInk(true);
      if (fresh.ok || !ink?.cartridges.some((c) => c.level !== null))
        setManual(fresh);
      if (!fresh.ok)
        push({
          kind: "info",
          title: "Ink check finished",
          desc: fresh.message.slice(0, 160),
        });
    } catch (err: any) {
      push({
        kind: "error",
        title: "Couldn't refresh ink levels",
        desc: String(err.message || err).slice(0, 200),
      });
    } finally {
      setRefreshing(false);
    }
  };

  const subtitle = inkSubtitle(ink, stale);

  return (
    <div className="supplies-panel">
      <CardHeader
        icon={<Droplet size={16} />}
        title="Ink levels"
        sub={subtitle}
        tileBg={vars.accentSoft as string}
        tileColor={vars.accent as string}
        right={
          <button
            {...stylex.props(ui.buttonQuiet, s.refresh)}
            onClick={refresh}
            disabled={refreshing}
            aria-label="Refresh ink levels"
          >
            <RefreshCw size={13} className={refreshing ? "spin" : undefined} />{" "}
            {refreshing ? "Checking…" : "Refresh"}
          </button>
        }
      />
      <CartridgeList ink={ink} />
      <style>{`.spin{animation:spin 1.2s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function inkSubtitle(ink: InkStatus | null | undefined, stale: boolean) {
  if (!ink) return "Checking printer supplies…";
  if (!ink.ok) return ink.message.slice(0, 90);
  return `${stale ? "Last known · " : ""}Supplies updated ${formatTime(ink.updated_at)}`;
}

function CartridgeList({
  ink,
}: Readonly<{ ink: InkStatus | null | undefined }>) {
  if (!ink?.updated_at)
    return (
      <div {...stylex.props(ui.statusRow)}>
        <StatusDot tone="idle" /> Checking printer supplies…
      </div>
    );
  if (!ink.cartridges.length)
    return (
      <p {...stylex.props(ui.help)}>
        No ink data yet. Make sure the printer is awake, then press Refresh.
      </p>
    );
  return (
    <div {...stylex.props(s.grid)}>
      {ink.cartridges.map((cartridge) => (
        <InkCartridge key={cartridge.key} cartridge={cartridge} />
      ))}
    </div>
  );
}

function inkColor(cartridge: InkStatus["cartridges"][number]) {
  if (cartridge.state === "empty") return vars.bad as string;
  if (cartridge.state === "low") return vars.warn as string;
  return cartridge.color;
}

function inkLevelText(cartridge: InkStatus["cartridges"][number]) {
  if (cartridge.level == null) return "Unknown";
  if (cartridge.state === "low") return `${cartridge.level}% · Low`;
  if (cartridge.state === "empty") return `${cartridge.level}% · Empty`;
  return `${cartridge.level}%`;
}

function InkCartridge({
  cartridge: c,
}: Readonly<{ cartridge: InkStatus["cartridges"][number] }>) {
  let warning: string | undefined;
  if (c.state === "low") warning = "Ink is low";
  if (c.state === "empty") warning = "Cartridge is empty";
  return (
    <div {...stylex.props(s.row)}>
      <span
        {...stylex.props(s.dot)}
        style={{ backgroundColor: c.color }}
        aria-hidden="true"
      />
      <div {...stylex.props(s.nameWrap)}>
        <div {...stylex.props(s.name)}>{c.name}</div>
        <div {...stylex.props(s.sub)}>{c.state}</div>
      </div>
      <progress
        {...stylex.props(s.bar)}
        className={`${stylex.props(s.bar).className} ink-level`}
        title={warning}
        value={c.level ?? 0}
        max={100}
        aria-label={`${c.name} ink`}
        aria-valuetext={c.level == null ? "Unknown" : `${c.level}%`}
        style={
          {
            "--ink-color": inkColor(c),
            opacity: c.level == null ? 0.25 : 1,
          } as CSSProperties
        }
      />
      <span {...stylex.props(s.pct)}>{inkLevelText(c)}</span>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
