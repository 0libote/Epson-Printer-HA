import * as stylex from "@stylexjs/stylex";
import { vars } from "../styles/tokens.stylex";
import { Moon, Printer, Sun } from "lucide-react";
import { useTheme } from "../styles/ThemeProvider";
import { Pill, StatusDot } from "./ui";

const s = stylex.create({
  bar: {
    position: "sticky",
    top: 0,
    zIndex: 20,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: vars.line,
    backgroundColor: vars.panel,
  },
  inner: {
    maxWidth: "1080px",
    margin: "0 auto",
    padding: "0 20px",
    height: "60px",
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  brand: { display: "flex", alignItems: "center", gap: "10px", textDecoration: "none", color: vars.text },
  mark: {
    width: "32px",
    height: "32px",
    borderRadius: "9px",
    backgroundColor: vars.accent,
    color: vars.onAccent,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  },
  name: { fontFamily: vars.fontSans, fontSize: "15px", fontWeight: 650, letterSpacing: "-0.01em", lineHeight: 1.1 },
  sub: { fontFamily: vars.fontMono, fontSize: "11px", color: vars.textTertiary },
  spacer: { flex: 1 },
  iconBtn: {
    width: "36px",
    height: "36px",
    borderRadius: vars.radiusFull,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.line,
    backgroundColor: "transparent",
    color: vars.textSecondary,
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
  },
});

export function Header({ printerName, displayName, online, setupNeeded }: { printerName: string; displayName: string; online: boolean; setupNeeded: boolean }) {
  const { theme, toggle } = useTheme();
  return (
    <header {...stylex.props(s.bar)}>
      <div {...stylex.props(s.inner)}>
        <a {...stylex.props(s.brand)} href="/">
          <span {...stylex.props(s.mark)}><Printer size={17} /></span>
          <span>
            <span {...stylex.props(s.name)}>Print Room</span>
            <br />
            <span {...stylex.props(s.sub)}>{setupNeeded ? "setup" : displayName || printerName}</span>
          </span>
        </a>
        <span {...stylex.props(s.spacer)} />
        {setupNeeded ? (
          <Pill tone="warn"><StatusDot tone="warn" /> Setup needed</Pill>
        ) : online ? (
          <Pill tone="good"><StatusDot tone="good" /> Online</Pill>
        ) : (
          <Pill tone="bad"><StatusDot tone="bad" /> Offline</Pill>
        )}
        <button {...stylex.props(s.iconBtn)} onClick={toggle} aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"} title="Toggle theme">
          {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
        </button>
      </div>
    </header>
  );
}
