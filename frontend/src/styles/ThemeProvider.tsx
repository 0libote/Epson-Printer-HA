import * as stylex from "@stylexjs/stylex";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { themes, type ThemeName } from "./tokens.stylex";

const ThemeContext = createContext<{ theme: ThemeName; setTheme: (t: ThemeName) => void; toggle: () => void }>({
  theme: "light",
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
  try {
    if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
  } catch {}
  return "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(initialTheme);

  const setTheme = (t: ThemeName) => {
    setThemeState(t);
    try { localStorage.setItem(STORAGE_KEY, t); } catch {}
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
      <div {...stylex.props(themes[theme])} style={{ colorScheme: theme, minHeight: "100vh" }}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
