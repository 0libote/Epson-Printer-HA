import * as stylex from "@stylexjs/stylex";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { themes, type ThemeName } from "./tokens.stylex";

const ThemeContext = createContext<{ theme: ThemeName; setTheme: (t: ThemeName) => void }>({
  theme: "retro",
  setTheme: () => {},
});

export const useTheme = () => useContext(ThemeContext);

const STORAGE_KEY = "epson-hub-theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as ThemeName | null;
      if (saved && saved in themes) return saved;
    } catch {}
    // respect prefers-color-scheme for industrial/midnight?
    try {
      if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "industrial";
    } catch {}
    return "retro";
  });

  const setTheme = (t: ThemeName) => {
    setThemeState(t);
    try { localStorage.setItem(STORAGE_KEY, t); } catch {}
    try { document.documentElement.setAttribute("data-theme", t); } catch {}
  };

  useEffect(() => {
    try { document.documentElement.setAttribute("data-theme", theme); } catch {}
  }, [theme]);

  // apply StyleX theme class to wrapping div
  const activeTheme = themes[theme];

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <div {...stylex.props(activeTheme)}>{children}</div>
    </ThemeContext.Provider>
  );
}
