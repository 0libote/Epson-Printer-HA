import * as stylex from "@stylexjs/stylex";

// ————————————————————————————————————————————————
// Print Room — neutral surfaces, blue actions and semantic device states.
// Components only ever read `vars.*`; light/dark themes override them.
// ————————————————————————————————————————————————
export const vars = stylex.defineVars({
  // surfaces
  bg: "#f3f5f8",
  bgSunken: "#e9edf3",
  panel: "#ffffff",
  panelHover: "#f7f9fc",
  overlay: "rgba(20, 22, 26, 0.45)",

  // text
  text: "#242e3d",
  textSecondary: "#526175",
  textTertiary: "#5c6c81",

  // lines
  line: "#dce2eb",
  lineStrong: "#b8c3d2",

  // Primary actions and selection
  accent: "#315f9e",
  accentHover: "#284e82",
  accentSoft: "#e3ebf7",
  accentText: "#ffffff",
  onAccent: "#ffffff",

  // Scan actions share the same interaction color
  teal: "#315f9e",
  tealHover: "#284e82",
  tealSoft: "#e3ebf7",

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
  radiusLg: "14px",
  radiusFull: "9999px",
  shadowSm: "none",
  shadowMd: "0 8px 28px rgba(0, 0, 0, 0.16)",

  // type
  fontSans: `"Segoe UI Variable", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif`,
  fontMono: `"SFMono-Regular", Consolas, "Liberation Mono", monospace`,
});

export const lightTheme = stylex.createTheme(vars, {
  bg: "#f3f5f8",
  bgSunken: "#e9edf3",
  panel: "#ffffff",
  panelHover: "#f7f9fc",
  overlay: "rgba(20, 22, 26, 0.45)",
  text: "#242e3d",
  textSecondary: "#526175",
  textTertiary: "#5c6c81",
  line: "#dce2eb",
  lineStrong: "#b8c3d2",
  accent: "#315f9e",
  accentHover: "#284e82",
  accentSoft: "#e3ebf7",
  accentText: "#ffffff",
  onAccent: "#ffffff",
  teal: "#315f9e",
  tealHover: "#284e82",
  tealSoft: "#e3ebf7",
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
  bg: "#14171c",
  bgSunken: "#191d24",
  panel: "#20252d",
  panelHover: "#272e39",
  overlay: "rgba(0, 0, 0, 0.6)",
  text: "#f0f3f8",
  textSecondary: "#acb6c6",
  textTertiary: "#94a0b2",
  line: "#353d49",
  lineStrong: "#536176",
  accent: "#a8c8ff",
  accentHover: "#c0d7ff",
  accentSoft: "#26374f",
  accentText: "#14171c",
  onAccent: "#14171c",
  teal: "#a8c8ff",
  tealHover: "#c0d7ff",
  tealSoft: "#26374f",
  good: "#8dccaf",
  goodSoft: "#21362c",
  warn: "#e4bd85",
  warnSoft: "#3a3022",
  bad: "#f0a1aa",
  badSoft: "#3d2729",
  shadowSm: "none",
  shadowMd: "0 8px 28px rgba(0, 0, 0, 0.3)",
});

export const themes = {
  light: lightTheme,
  dark: darkTheme,
} as const;

export type ThemeName = keyof typeof themes;
