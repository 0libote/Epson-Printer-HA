import * as stylex from "@stylexjs/stylex";

// Playful Retro — Neubrutalist / Memphis for HomeLab
// Thick black strokes, hard shadows, paper textures, bold cheerful accents
export const vars = stylex.defineVars({
  // base paper
  bg: "#FFF8E7", // warm cream
  bgSubtle: "#FFEDC2", // pale mustard wash
  panel: "#ffffff",
  panelSoft: "#FFF8E7",
  text: "#111111", // near-black for contrast
  textMuted: "#3A3A3A",
  textFaint: "#6B6B6B",
  line: "#111111", // brutalist stroke
  lineStrong: "#111111",
  // cheerful Memphis palette
  yellow: "#FFCC02",
  yellowDark: "#E8B900",
  pink: "#FF5A8A",
  pinkDark: "#E04472",
  teal: "#2EC4B6",
  tealDark: "#1AA99C",
  blue: "#3A86FF",
  blueDark: "#265FCC",
  blueSoft: "#E6EFFF",
  lilac: "#A78BFA",
  lime: "#B8FF66",
  // semantic aliases mapped to palette
  good: "#00C950",
  goodSoft: "#E6F9EC",
  warn: "#FF9F1C",
  warnSoft: "#FFF4DE",
  bad: "#FF3B30",
  badSoft: "#FFE9E8",
  // brutalist shadows & radii
  shadowSm: "2px 2px 0px #111",
  shadowMd: "4px 4px 0px #111",
  shadowLg: "8px 8px 0px #111",
  shadowHard: "6px 6px 0px #111",
  radiusSm: "12px",
  radiusMd: "16px",
  radiusLg: "20px",
  radiusXl: "28px",
  radiusFull: "9999px",
});

export const lightTheme = stylex.createTheme(vars, {
  bg: "#FFF8E7",
  bgSubtle: "#FFEDC2",
  panel: "#ffffff",
  panelSoft: "#FFF8E7",
  text: "#111111",
  textMuted: "#3A3A3A",
  textFaint: "#6B6B6B",
  line: "#111111",
  lineStrong: "#111111",
});

export const spacing = {
  xs: "6px",
  sm: "10px",
  md: "16px",
  lg: "24px",
  xl: "32px",
} as const;
