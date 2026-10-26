import { Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { useTheme } from "../styles/ThemeProvider";
import { Brand } from "./WorkspaceNavigation";

export function Header({
  online,
  setupNeeded,
  checking = false,
  stale = false,
  children,
}: {
  online: boolean;
  setupNeeded: boolean;
  checking?: boolean;
  stale?: boolean;
  children?: ReactNode;
}) {
  const { theme, toggle } = useTheme();
  const label = setupNeeded
    ? "Setup needed"
    : checking
      ? "Checking connection"
      : stale
        ? "Last known status"
        : online
          ? "Printer connected"
          : "Printer offline";
  const tone =
    setupNeeded || checking || stale ? "neutral" : online ? "good" : "warn";
  return (
    <header className="app-topbar">
      <div className="mobile-brand">
        <Brand />
      </div>
      <span className="topbar-title">Epson printer hub</span>
      <div className="topbar-actions">
        <span
          className={`connection-status is-${tone}`}
          role="status"
          aria-label={label}
        >
          <i className="status-light" />
          <span className="connection-label-long">{label}</span>
          <span className="connection-label-short" aria-hidden="true">
            {setupNeeded
              ? "Setup"
              : checking
                ? "Checking"
                : stale
                  ? "Last known"
                  : online
                    ? "Online"
                    : "Offline"}
          </span>
        </span>
        {children}
        <button
          className="icon-button theme-button"
          type="button"
          onClick={toggle}
          aria-label={
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
          title={theme === "dark" ? "Light mode" : "Dark mode"}
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
}
