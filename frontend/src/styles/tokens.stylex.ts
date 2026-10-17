import * as stylex from "@stylexjs/stylex";

// ————————————————————————————————————————————————
// Print Room — design tokens
// A calm device console for a home-lab printer appliance.
// Components only ever read `vars.*`; light/dark themes override them.
// ————————————————————————————————————————————————
export const vars = stylex.defineVars({
  // surfaces
  bg: "#f6f5f2",
  bgSunken: "#eeede9",
  panel: "#ffffff",
  panelHover: "#fafaf9",
  overlay: "rgba(20, 22, 26, 0.45)",

  // text
  text: "#282733",
  textSecondary: "#64616e",
  textTertiary: "#76727e",

  // lines
  line: "#e7e5e0",
  lineStrong: "#d7d4de",

  // accent — violet for primary actions and focus
  accent: "#6554c0",
  accentHover: "#5040a4",
  accentSoft: "#f0ecfa",
  accentText: "#ffffff",
  onAccent: "#ffffff",

  // scan accent — deep teal
  teal: "#416c66",
  tealHover: "#305951",
  tealSoft: "#edf4f1",

  // semantics
  good: "#237957",
  goodSoft: "#edf6ef",
  warn: "#a65017",
  warnSoft: "#fdf0e6",
  bad: "#e03131",
  badSoft: "#fdecec",

  // shape + depth
  radiusSm: "8px",
  radiusMd: "12px",
  radiusLg: "18px",
  radiusFull: "9999px",
  shadowSm: "0 1px 2px rgba(23, 24, 26, 0.06)",
  shadowMd: "0 1px 2px rgba(23, 24, 26, 0.06), 0 8px 24px -12px rgba(23, 24, 26, 0.18)",

  // type
  fontSans: `Inter, system-ui, -apple-system, "Segoe UI", sans-serif`,
  fontMono: `"JetBrains Mono", ui-monospace, SFMono-Regular, monospace`,
});

export const lightTheme = stylex.createTheme(vars, {
  bg: "#f6f5f2",
  bgSunken: "#eeede9",
  panel: "#ffffff",
  panelHover: "#fafaf9",
  overlay: "rgba(20, 22, 26, 0.45)",
  text: "#282733",
  textSecondary: "#64616e",
  textTertiary: "#76727e",
  line: "#e7e5e0",
  lineStrong: "#d7d4de",
  accent: "#6554c0",
  accentHover: "#5040a4",
  accentSoft: "#f0ecfa",
  accentText: "#ffffff",
  onAccent: "#ffffff",
  teal: "#416c66",
  tealHover: "#305951",
  tealSoft: "#edf4f1",
  good: "#237957",
  goodSoft: "#edf6ef",
  warn: "#a65017",
  warnSoft: "#fdf0e6",
  bad: "#e03131",
  badSoft: "#fdecec",
  shadowSm: "0 1px 2px rgba(23, 24, 26, 0.06)",
  shadowMd: "0 1px 2px rgba(23, 24, 26, 0.06), 0 8px 24px -12px rgba(23, 24, 26, 0.18)",
});

export const darkTheme = stylex.createTheme(vars, {
  bg: "#16151b",
  bgSunken: "#1c1b23",
  panel: "#211f29",
  panelHover: "#272430",
  overlay: "rgba(0, 0, 0, 0.6)",
  text: "#f0edf5",
  textSecondary: "#bdb6cb",
  textTertiary: "#a29aae",
  line: "#35313e",
  lineStrong: "#4c4659",
  accent: "#b8a6f3",
  accentHover: "#cfc0fb",
  accentSoft: "#302840",
  accentText: "#16151b",
  onAccent: "#16151b",
  teal: "#93cec0",
  tealHover: "#afe0d4",
  tealSoft: "#233d36",
  good: "#51cf66",
  goodSoft: "#12291a",
  warn: "#ffa94d",
  warnSoft: "#2f2012",
  bad: "#ff6b6b",
  badSoft: "#331414",
  shadowSm: "0 1px 2px rgba(0, 0, 0, 0.4)",
  shadowMd: "0 1px 2px rgba(0, 0, 0, 0.4), 0 12px 32px -12px rgba(0, 0, 0, 0.6)",
});

export const themes = {
  light: lightTheme,
  dark: darkTheme,
} as const;

export type ThemeName = keyof typeof themes;
