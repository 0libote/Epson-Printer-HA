import * as stylex from "@stylexjs/stylex";
import { vars } from "../styles/tokens.stylex";
import { useTheme } from "../styles/ThemeProvider";
import type { ThemeName } from "../styles/tokens.stylex";
import { Palette, Sun, Moon, Factory, FileText, Sparkles, Zap } from "lucide-react";

const themesMeta: Record<ThemeName, { label: string; vibe: string; icon: any; accent: string; desc: string }> = {
  retro: { label: "Retro Pop", vibe: "Neubrutalist", icon: Sparkles, accent: "#FFCC02", desc: "Mustard + hard shadows" },
  industrial: { label: "Homelab", vibe: "Industrial Dark", icon: Factory, accent: "#ffb000", desc: "Charcoal + amber" },
  minimal: { label: "Air", vibe: "Minimal", icon: Sun, accent: "#0ea5e9", desc: "Inter + soft blur" },
  paper: { label: "Paper", vibe: "Editorial", icon: FileText, accent: "#d97706", desc: "Newsreader + ink" },
  midnight: { label: "Midnight", vibe: "OLED Neon", icon: Moon, accent: "#f472b6", desc: "Black + glow" },
};

const s = stylex.create({
  wrap: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px",
    backgroundColor: "white",
    borderWidth: "2.5px",
    borderStyle: "solid",
    borderColor: vars.line,
    borderRadius: vars.radiusFull,
    boxShadow: vars.shadowSm,
  },
  btn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "7px 12px",
    borderRadius: vars.radiusFull,
    borderWidth: "2.5px",
    borderStyle: "solid",
    borderColor: "transparent",
    backgroundColor: "transparent",
    fontFamily: vars.fontMono,
    fontSize: "11px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: ".04em",
    cursor: "pointer",
    color: vars.textMuted,
    transition: "all .15s",
    whiteSpace: "nowrap",
  },
  btnActive: {
    backgroundColor: vars.text,
    color: "white",
    borderColor: vars.line,
    boxShadow: `2px 2px 0 ${vars.line}`,
  },
  dot: {
    width: "10px",
    height: "10px",
    borderRadius: vars.radiusFull,
    borderWidth: "2px",
    borderStyle: "solid",
    borderColor: vars.line,
    flexShrink: 0,
  },
  label: { display: "inline-flex", flexDirection: "column", lineHeight: 1 },
  vibe: { fontSize: "9px", opacity: 0.6, fontWeight: 500 },
});

export function ThemePicker({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  return (
    <div {...stylex.props(s.wrap)} role="radiogroup" aria-label="Theme picker">
      {(Object.keys(themesMeta) as ThemeName[]).map((key) => {
        const meta = themesMeta[key];
        const Icon = meta.icon;
        const active = theme === key;
        return (
          <button
            key={key}
            role="radio"
            aria-checked={active}
            {...stylex.props(s.btn, active && s.btnActive)}
            onClick={() => setTheme(key)}
            title={`${meta.label} — ${meta.desc}`}
          >
            <span {...stylex.props(s.dot)} style={{ background: meta.accent }} aria-hidden="true" />
            {!compact && (
              <span {...stylex.props(s.label)}>
                <span>{meta.label}</span>
                <span {...stylex.props(s.vibe)}>{meta.vibe}</span>
              </span>
            )}
            {compact && <Icon size={14} />}
          </button>
        );
      })}
    </div>
  );
}

export function ThemePickerCard() {
  const { theme, setTheme } = useTheme();
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: vars.fontDisplay as string, fontWeight: 700, fontSize: 13 }}>
        <Palette size={16} /> PICK YOUR VIBE
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
        {(Object.keys(themesMeta) as ThemeName[]).map((k) => {
          const m = themesMeta[k];
          const active = theme === k;
          const Icon = m.icon;
          return (
            <button
              key={k}
              onClick={() => setTheme(k)}
              style={{
                textAlign: "left",
                padding: 14,
                borderRadius: 16,
                border: `3px solid ${active ? "#111" : "#e5e7eb"}`,
                background: active ? "#111" : "white",
                color: active ? "white" : "#111",
                boxShadow: active ? `4px 4px 0 #111` : `2px 2px 0 #111`,
                cursor: "pointer",
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
                transform: active ? "rotate(-0.5deg)" : "none",
              }}
            >
              <span style={{ width: 36, height: 36, borderRadius: 10, background: m.accent, border: "2.5px solid #111", display: "grid", placeItems: "center", flexShrink: 0, color: "#111" }}>
                <Icon size={16} />
              </span>
              <span>
                <strong style={{ display: "block", fontFamily: vars.fontDisplay as string, fontSize: 13, lineHeight: 1 }}>{m.label}</strong>
                <small style={{ display: "block", fontFamily: vars.fontMono as string, fontSize: 10, opacity: 0.7, textTransform: "uppercase", marginTop: 2 }}>{m.vibe}</small>
                <small style={{ display: "block", fontFamily: vars.fontMono as string, fontSize: 10, opacity: active ? 0.9 : 0.5, marginTop: 4 }}>{m.desc}</small>
              </span>
            </button>
          );
        })}
      </div>
      <small style={{ fontFamily: vars.fontMono as string, fontSize: 10, opacity: 0.5, textTransform: "uppercase" }}>Saved to this device • works offline • try them all</small>
    </div>
  );
}
