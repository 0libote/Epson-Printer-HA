import * as stylex from "@stylexjs/stylex";
import { vars } from "../styles/tokens.stylex";
import type { ReactNode } from "react";

// ————————————————————————————————————————————
// Shared primitives — every control in one calm language
// ————————————————————————————————————————————

export const s = stylex.create({
  card: {
    backgroundColor: vars.panel,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.line,
    borderRadius: vars.radiusLg,
    boxShadow: vars.shadowSm,
  },
  cardPad: { padding: "20px" },
  cardTitle: {
    fontFamily: vars.fontSans,
    fontSize: "15px",
    fontWeight: 600,
    letterSpacing: "-0.01em",
    color: vars.text,
  },
  cardSub: {
    fontFamily: vars.fontSans,
    fontSize: "13px",
    color: vars.textSecondary,
    marginTop: "2px",
  },
  cardHead: {
    display: "flex",
    alignItems: "flex-start",
    gap: "12px",
    marginBottom: "16px",
  },
  iconTile: {
    width: "36px",
    height: "36px",
    borderRadius: "10px",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  },
  fieldLabel: {
    display: "grid",
    gap: "6px",
    fontFamily: vars.fontSans,
    fontSize: "12.5px",
    fontWeight: 500,
    color: vars.textSecondary,
  },
  input: {
    width: "100%",
    minHeight: "40px",
    padding: "8px 12px",
    borderRadius: vars.radiusSm,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.lineStrong,
    backgroundColor: vars.panel,
    color: vars.text,
    fontFamily: vars.fontSans,
    fontSize: "14px",
  },
  select: {
    width: "100%",
    minHeight: "40px",
    padding: "8px 12px",
    borderRadius: vars.radiusSm,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.lineStrong,
    backgroundColor: vars.panel,
    color: vars.text,
    fontFamily: vars.fontSans,
    fontSize: "14px",
  },
  buttonPrimary: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    minHeight: "42px",
    padding: "0 18px",
    borderRadius: vars.radiusSm,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "transparent",
    backgroundColor: vars.accent,
    color: vars.onAccent,
    fontFamily: vars.fontSans,
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    width: "100%",
  },
  buttonPrimaryDisabled: { opacity: 0.55, cursor: "wait" },
  buttonTeal: { backgroundColor: vars.teal },
  buttonQuiet: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "7px 12px",
    borderRadius: vars.radiusSm,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.line,
    backgroundColor: "transparent",
    color: vars.textSecondary,
    fontFamily: vars.fontSans,
    fontSize: "13px",
    fontWeight: 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  buttonDanger: { color: vars.bad, borderColor: vars.line },
  buttonDisabled: { opacity: 0.5, cursor: "not-allowed" },
  help: {
    fontFamily: vars.fontSans,
    fontSize: "12.5px",
    lineHeight: 1.5,
    color: vars.textTertiary,
  },
  errorBox: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    padding: "10px 12px",
    borderRadius: vars.radiusSm,
    backgroundColor: vars.badSoft,
    color: vars.bad,
    fontFamily: vars.fontSans,
    fontSize: "13px",
    lineHeight: 1.45,
  },
  noteBox: {
    padding: "10px 12px",
    borderRadius: vars.radiusSm,
    backgroundColor: vars.bgSunken,
    color: vars.textSecondary,
    fontFamily: vars.fontSans,
    fontSize: "12.5px",
    lineHeight: 1.5,
  },
  mono: { fontFamily: vars.fontMono },
  progressTrack: {
    height: "6px",
    borderRadius: vars.radiusFull,
    backgroundColor: vars.bgSunken,
    overflow: "hidden",
  },
  progressBar: {
    display: "block",
    height: "100%",
    width: "40%",
    borderRadius: vars.radiusFull,
    backgroundColor: vars.accent,
  },
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontFamily: vars.fontSans,
    fontSize: "13px",
    color: vars.textSecondary,
  },
  // status pill
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "7px",
    padding: "5px 12px 5px 9px",
    borderRadius: vars.radiusFull,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.line,
    backgroundColor: vars.panel,
    fontFamily: vars.fontSans,
    fontSize: "12.5px",
    fontWeight: 500,
    color: vars.textSecondary,
    whiteSpace: "nowrap",
  },
  pillGood: { backgroundColor: vars.goodSoft, borderColor: "transparent", color: vars.good },
  pillWarn: { backgroundColor: vars.warnSoft, borderColor: "transparent", color: vars.warn },
  pillBad: { backgroundColor: vars.badSoft, borderColor: "transparent", color: vars.bad },
  dot: { width: "7px", height: "7px", borderRadius: vars.radiusFull, flexShrink: 0 },
  // section heading
  sectionHead: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "12px",
    marginBottom: "12px",
  },
  sectionTitle: {
    fontFamily: vars.fontSans,
    fontSize: "13px",
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: vars.textTertiary,
  },
  // modal
  scrim: {
    position: "fixed",
    inset: 0,
    zIndex: 50,
    backgroundColor: vars.overlay,
    display: "grid",
    placeItems: "center",
    padding: "16px",
  },
  modal: {
    width: "min(880px, 96vw)",
    maxHeight: "90vh",
    overflow: "auto",
    backgroundColor: vars.panel,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.line,
    borderRadius: vars.radiusLg,
    boxShadow: vars.shadowMd,
    padding: "20px",
  },
  skeleton: {
    borderRadius: vars.radiusSm,
    backgroundColor: vars.bgSunken,
  },
});

export function Card({ children, pad = true }: { children: ReactNode; pad?: boolean }) {
  return <section {...stylex.props(s.card, pad && s.cardPad)}>{children}</section>;
}

export function CardHeader({ icon, title, sub, right, tileBg, tileColor }: { icon: ReactNode; title: string; sub: string; right?: ReactNode; tileBg?: string; tileColor?: string }) {
  return (
    <div {...stylex.props(s.cardHead)}>
      <span {...stylex.props(s.iconTile)} style={{ backgroundColor: tileBg, color: tileColor }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 {...stylex.props(s.cardTitle)}>{title}</h2>
        <p {...stylex.props(s.cardSub)}>{sub}</p>
      </div>
      {right}
    </div>
  );
}

export function StatusDot({ tone }: { tone: "good" | "warn" | "bad" | "idle" }) {
  const bg = tone === "good" ? vars.good : tone === "warn" ? vars.warn : tone === "bad" ? vars.bad : vars.textTertiary;
  return <span {...stylex.props(s.dot)} style={{ backgroundColor: bg as string }} aria-hidden="true" />;
}

export function Pill({ tone, children }: { tone?: "good" | "warn" | "bad"; children: ReactNode }) {
  return (
    <span {...stylex.props(s.pill, tone === "good" && s.pillGood, tone === "warn" && s.pillWarn, tone === "bad" && s.pillBad)}>
      {children}
    </span>
  );
}

export function ProgressBar({ color }: { color?: string }) {
  return (
    <div {...stylex.props(s.progressTrack)} role="progressbar" aria-label="Working">
      <span {...stylex.props(s.progressBar)} style={color ? { backgroundColor: color } : undefined} />
      <style>{`@keyframes slide{from{transform:translateX(-100%)}to{transform:translateX(250%)}} [role="progressbar"] > span{animation:slide 1.2s ease-in-out infinite}`}</style>
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ padding: "28px 20px", textAlign: "center" }}>
      <p style={{ fontFamily: vars.fontSans as string, fontSize: 14, fontWeight: 600, color: vars.text as string }}>{title}</p>
      <p {...stylex.props(s.help)} style={{ marginTop: 4 }}>{body}</p>
    </div>
  );
}

export function safeLabel(state: unknown, fallback = "Unknown"): string {
  if (typeof state !== "string" || !state) return fallback;
  return state.replace(/_/g, " ");
}
