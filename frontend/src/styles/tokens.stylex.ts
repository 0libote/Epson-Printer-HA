import * as stylex from "@stylexjs/stylex";

export const vars = stylex.defineVars({
  bg: "#f7f9fb",
  bgSubtle: "#f1f5f9",
  panel: "#ffffff",
  panelSoft: "#f8fafc",
  panelHover: "#f8fafc",
  text: "#0f172a",
  textMuted: "#64748b",
  textFaint: "#94a3b8",
  line: "#e2e8f0",
  lineStrong: "#cbd5e1",
  blue: "#2563eb",
  blueDark: "#1e40af",
  blueSoft: "#eff6ff",
  blueBorder: "#bfdbfe",
  teal: "#0d9488",
  tealDark: "#0f766e",
  tealSoft: "#f0fdfa",
  good: "#059669",
  goodSoft: "#ecfdf5",
  warn: "#d97706",
  warnSoft: "#fffbeb",
  bad: "#dc2626",
  badSoft: "#fef2f2",
  shadowSm: "0 1px 2px rgba(15,23,42,.06)",
  shadowMd: "0 8px 30px rgba(15,23,42,.08)",
  shadowLg: "0 16px 40px rgba(15,23,42,.12)",
  radiusSm: "10px",
  radiusMd: "14px",
  radiusLg: "18px",
  radiusXl: "22px",
  radiusFull: "9999px",
});

export const lightTheme = stylex.createTheme(vars, {
  bg: "#f7f9fb",
  bgSubtle: "#f1f5f9",
  panel: "#ffffff",
  panelSoft: "#f8fafc",
  text: "#0f172a",
  textMuted: "#64748b",
  textFaint: "#94a3b8",
  line: "#e2e8f0",
  lineStrong: "#cbd5e1",
});

// semantic aliases
export const spacing = {
  xs: "6px",
  sm: "10px",
  md: "16px",
  lg: "24px",
  xl: "32px",
} as const;
