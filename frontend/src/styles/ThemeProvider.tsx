import * as stylex from "@stylexjs/stylex";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { vars, themes, type ThemeName } from "./tokens.stylex";

const ThemeContext = createContext<{
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
  toggle: () => void;
}>({
  theme: "dark",
  setTheme: () => {},
  toggle: () => {},
});

export const useTheme = () => useContext(ThemeContext);

const STORAGE_KEY = "print-room-theme";

function initialTheme(): ThemeName {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {}
  return "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(initialTheme);

  const setTheme = (t: ThemeName) => {
    setThemeState(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {}
  };
  const toggle = () => setTheme(theme === "light" ? "dark" : "light");

  useEffect(() => {
    try {
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    } catch {}
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      <div
        {...stylex.props(themes[theme])}
        style={
          {
            colorScheme: theme,
            minHeight: "100vh",
            backgroundColor: vars.bg,
            color: vars.text,
            "--ui-bg": vars.bg,
            "--ui-panel": vars.panel,
            "--ui-inset": vars.bgSunken,
            "--ui-hover": vars.panelHover,
            "--ui-text": vars.text,
            "--ui-muted": vars.textSecondary,
            "--ui-subtle": vars.textTertiary,
            "--ui-line": vars.line,
            "--ui-border-strong": vars.lineStrong,
            "--ui-accent": vars.accent,
            "--ui-accent-hover": vars.accentHover,
            "--ui-on-accent": vars.onAccent,
            "--ui-soft": vars.accentSoft,
            "--ui-good": vars.good,
            "--ui-good-soft": vars.goodSoft,
            "--ui-warn": vars.warn,
            "--ui-warn-soft": vars.warnSoft,
            "--ui-bad": vars.bad,
            "--ui-bad-soft": vars.badSoft,
            "--ui-scan": vars.teal,
            "--ui-scan-soft": vars.tealSoft,
          } as CSSProperties
        }
      >
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
