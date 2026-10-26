import * as stylex from "@stylexjs/stylex";

// ————————————————————————————————————————————————
// Print Room — neutral surfaces, blue actions and semantic device states.
// Components only ever read `vars.*`; light/dark themes override them.
// ————————————————————————————————————————————————
export const vars = stylex.defineVars({
  // surfaces
  bg: "#f4f5f6",
  bgSunken: "#e9ebee",
  panel: "#ffffff",
  panelHover: "#f8f9fa",
  overlay: "rgba(20, 22, 26, 0.45)",

  // text
  text: "#25282d",
  textSecondary: "#575d66",
  textTertiary: "#626973",

  // lines
  line: "#dfe2e6",
  lineStrong: "#bdc3cc",

  // accent — violet for primary actions and focus
  accent: "#315f9c",
  accentHover: "#264b7d",
  accentSoft: "#eaf0f8",
  accentText: "#ffffff",
  onAccent: "#ffffff",

  // scan accent — deep teal
  teal: "#315f9c",
  tealHover: "#264b7d",
  tealSoft: "#eaf0f8",

  // semantics
  good: "#237957",
  goodSoft: "#edf6ef",
  warn: "#a65017",
  warnSoft: "#fdf0e6",
  bad: "#e03131",
  badSoft: "#fdecec",

  // shape + depth
  radiusSm: "6px",
  radiusMd: "8px",
  radiusLg: "8px",
  radiusFull: "9999px",
  shadowSm: "none",
  shadowMd: "0 8px 28px rgba(0, 0, 0, 0.16)",

  // type
  fontSans: `"Segoe UI", system-ui, -apple-system, sans-serif`,
  fontMono: `"Segoe UI", system-ui, -apple-system, sans-serif`,
});

export const lightTheme = stylex.createTheme(vars, {
  bg: "#f4f5f6",
  bgSunken: "#e9ebee",
  panel: "#ffffff",
  panelHover: "#f8f9fa",
  overlay: "rgba(20, 22, 26, 0.45)",
  text: "#25282d",
  textSecondary: "#575d66",
  textTertiary: "#626973",
  line: "#dfe2e6",
  lineStrong: "#bdc3cc",
  accent: "#315f9c",
  accentHover: "#264b7d",
  accentSoft: "#eaf0f8",
  accentText: "#ffffff",
  onAccent: "#ffffff",
  teal: "#315f9c",
  tealHover: "#264b7d",
  tealSoft: "#eaf0f8",
  good: "#237957",
  goodSoft: "#edf6ef",
  warn: "#a65017",
  warnSoft: "#fdf0e6",
  bad: "#e03131",
  badSoft: "#fdecec",
  shadowSm: "none",
  shadowMd: "0 8px 28px rgba(0, 0, 0, 0.16)",
});

export const darkTheme = stylex.createTheme(vars, {
  bg: "#18191b",
  bgSunken: "#151618",
  panel: "#202225",
  panelHover: "#282b2f",
  overlay: "rgba(0, 0, 0, 0.6)",
  text: "#f0f1f2",
  textSecondary: "#bbc0c8",
  textTertiary: "#9ba2ad",
  line: "#373a3f",
  lineStrong: "#555b65",
  accent: "#9cbded",
  accentHover: "#bad2f4",
  accentSoft: "#293747",
  accentText: "#18191b",
  onAccent: "#18191b",
  teal: "#9cbded",
  tealHover: "#bad2f4",
  tealSoft: "#293747",
  good: "#8dcca7",
  goodSoft: "#24362c",
  warn: "#e7bd7c",
  warnSoft: "#3a3022",
  bad: "#f09b9b",
  badSoft: "#3d2729",
  shadowSm: "none",
  shadowMd: "0 8px 28px rgba(0, 0, 0, 0.3)",
});

export const themes = {
  light: lightTheme,
  dark: darkTheme,
} as const;

export type ThemeName = keyof typeof themes;
