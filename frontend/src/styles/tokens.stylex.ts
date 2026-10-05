import * as stylex from "@stylexjs/stylex";

// ————————————————————————————————————————————————
// Print Room — design tokens
// A calm device console for a home-lab printer appliance.
// Components only ever read `vars.*`; light/dark themes override them.
// ————————————————————————————————————————————————
export const vars = stylex.defineVars({
  // surfaces
  bg: "#f5f5f0",
  bgSunken: "#edeee8",
  panel: "#ffffff",
  panelHover: "#fafaf9",
  overlay: "rgba(20, 22, 26, 0.45)",

  // text
  text: "#20352e",
  textSecondary: "#56655d",
  textTertiary: "#67756b",

  // lines
  line: "#e2e7dc",
  lineStrong: "#ccd5c8",

  // accent — cobalt, used sparingly for primary actions + focus
  accent: "#25634c",
  accentHover: "#1a4c39",
  accentSoft: "#eaf3e7",
  accentText: "#ffffff",
  onAccent: "#ffffff",

  // scan accent — deep teal
  teal: "#3d617c",
  tealHover: "#2c4d66",
  tealSoft: "#edf3f8",

  // semantics
  good: "#2f9e44",
  goodSoft: "#e7f5ea",
  warn: "#d9480f",
  warnSoft: "#fdf0e6",
  bad: "#e03131",
  badSoft: "#fdecec",

  // shape + depth
  radiusSm: "10px",
  radiusMd: "16px",
  radiusLg: "22px",
  radiusFull: "9999px",
  shadowSm: "0 1px 2px rgba(23, 24, 26, 0.06)",
  shadowMd: "0 1px 2px rgba(23, 24, 26, 0.06), 0 8px 24px -12px rgba(23, 24, 26, 0.18)",

  // type
  fontSans: `Inter, system-ui, -apple-system, "Segoe UI", sans-serif`,
  fontMono: `"JetBrains Mono", ui-monospace, SFMono-Regular, monospace`,
});

export const lightTheme = stylex.createTheme(vars, {
  bg: "#f5f5f0",
  bgSunken: "#edeee8",
  panel: "#ffffff",
  panelHover: "#fafaf9",
  overlay: "rgba(20, 22, 26, 0.45)",
  text: "#20352e",
  textSecondary: "#56655d",
  textTertiary: "#67756b",
  line: "#e2e7dc",
  lineStrong: "#ccd5c8",
  accent: "#25634c",
  accentHover: "#1a4c39",
  accentSoft: "#eaf3e7",
  accentText: "#ffffff",
  onAccent: "#ffffff",
  teal: "#3d617c",
  tealHover: "#2c4d66",
  tealSoft: "#edf3f8",
  good: "#2f9e44",
  goodSoft: "#e7f5ea",
  warn: "#d9480f",
  warnSoft: "#fdf0e6",
  bad: "#e03131",
  badSoft: "#fdecec",
  shadowSm: "0 1px 2px rgba(23, 24, 26, 0.06)",
  shadowMd: "0 1px 2px rgba(23, 24, 26, 0.06), 0 8px 24px -12px rgba(23, 24, 26, 0.18)",
});

export const darkTheme = stylex.createTheme(vars, {
  bg: "#0d0f13",
  bgSunken: "#12151b",
  panel: "#161a21",
  panelHover: "#1a1f27",
  overlay: "rgba(0, 0, 0, 0.6)",
  text: "#eceef1",
  textSecondary: "#a6adba",
  textTertiary: "#98a59c",
  line: "#232936",
  lineStrong: "#323a4b",
  accent: "#91c9ab",
  accentHover: "#b1dfc5",
  accentSoft: "#203c2e",
  accentText: "#0d0f13",
  onAccent: "#0d0f13",
  teal: "#9dc5e4",
  tealHover: "#b4d7f1",
  tealSoft: "#223343",
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
