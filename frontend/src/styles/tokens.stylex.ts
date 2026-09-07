import * as stylex from "@stylexjs/stylex";

// ————————————————————————————————————————————————
// Print Room — design tokens
// A calm device console for a home-lab printer appliance.
// Components only ever read `vars.*`; light/dark themes override them.
// ————————————————————————————————————————————————
export const vars = stylex.defineVars({
  // surfaces
  bg: "#f6f6f4",
  bgSunken: "#ececea",
  panel: "#ffffff",
  panelHover: "#fafaf9",
  overlay: "rgba(20, 22, 26, 0.45)",

  // text
  text: "#17181a",
  textSecondary: "#55585e",
  textTertiary: "#8a8e96",

  // lines
  line: "#e2e2de",
  lineStrong: "#cfcfc9",

  // accent — cobalt, used sparingly for primary actions + focus
  accent: "#3b5bdb",
  accentHover: "#2f4bc4",
  accentSoft: "#edf1fd",
  accentText: "#ffffff",
  onAccent: "#ffffff",

  // scan accent — deep teal
  teal: "#0c8599",
  tealHover: "#0a6f81",
  tealSoft: "#e3f4f6",

  // semantics
  good: "#2f9e44",
  goodSoft: "#e7f5ea",
  warn: "#d9480f",
  warnSoft: "#fdf0e6",
  bad: "#e03131",
  badSoft: "#fdecec",

  // shape + depth
  radiusSm: "8px",
  radiusMd: "12px",
  radiusLg: "16px",
  radiusFull: "9999px",
  shadowSm: "0 1px 2px rgba(23, 24, 26, 0.06)",
  shadowMd: "0 1px 2px rgba(23, 24, 26, 0.06), 0 8px 24px -12px rgba(23, 24, 26, 0.18)",

  // type
  fontSans: `Inter, system-ui, -apple-system, "Segoe UI", sans-serif`,
  fontMono: `"JetBrains Mono", ui-monospace, SFMono-Regular, monospace`,
});

export const lightTheme = stylex.createTheme(vars, {
  bg: "#f6f6f4",
  bgSunken: "#ececea",
  panel: "#ffffff",
  panelHover: "#fafaf9",
  overlay: "rgba(20, 22, 26, 0.45)",
  text: "#17181a",
  textSecondary: "#55585e",
  textTertiary: "#8a8e96",
  line: "#e2e2de",
  lineStrong: "#cfcfc9",
  accent: "#3b5bdb",
  accentHover: "#2f4bc4",
  accentSoft: "#edf1fd",
  accentText: "#ffffff",
  onAccent: "#ffffff",
  teal: "#0c8599",
  tealHover: "#0a6f81",
  tealSoft: "#e3f4f6",
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
  textTertiary: "#6d7482",
  line: "#232936",
  lineStrong: "#323a4b",
  accent: "#748ffc",
  accentHover: "#91a7ff",
  accentSoft: "#1d2745",
  accentText: "#0d0f13",
  onAccent: "#0d0f13",
  teal: "#3bc9db",
  tealHover: "#66d9e8",
  tealSoft: "#12333a",
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
