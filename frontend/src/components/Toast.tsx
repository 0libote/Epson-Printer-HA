import * as stylex from "@stylexjs/stylex";
import { vars } from "../styles/tokens.stylex";
import { useState, useEffect, useRef, createContext, useContext, type ReactNode } from "react";
import { Check, AlertCircle, Info, X } from "lucide-react";

type Toast = { id: string; kind: "success" | "error" | "info"; title: string; desc?: string };
type ToastCtx = { push: (t: Omit<Toast, "id">) => void };

const ToastContext = createContext<ToastCtx>({ push: () => {} });
export const useToast = () => useContext(ToastContext);

const s = stylex.create({
  region: {
    position: "fixed",
    bottom: "20px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 9999,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    width: "min(420px, calc(100vw - 32px))",
  },
  toast: {
    display: "flex",
    gap: "10px",
    alignItems: "flex-start",
    padding: "12px 12px 12px 14px",
    borderRadius: vars.radiusMd,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.line,
    backgroundColor: vars.panel,
    boxShadow: vars.shadowMd,
    animationName: "toastIn",
    animationDuration: "180ms",
    animationTimingFunction: "ease-out",
  },
  icon: { flexShrink: 0, marginTop: "1px" },
  title: { margin: 0, fontFamily: vars.fontSans, fontSize: "13.5px", fontWeight: 600, color: vars.text, lineHeight: 1.35 },
  desc: { margin: "2px 0 0", fontFamily: vars.fontSans, fontSize: "12.5px", color: vars.textSecondary, lineHeight: 1.45, overflowWrap: "anywhere" },
  close: {
    marginLeft: "auto",
    flexShrink: 0,
    backgroundColor: "transparent",
    borderWidth: 0,
    borderStyle: "none",
    color: vars.textTertiary,
    cursor: "pointer",
    padding: "4px",
    borderRadius: "6px",
    display: "grid",
    placeItems: "center",
  },
});

function makeToastId() {
  try {
    const b = new Uint8Array(9);
    crypto.getRandomValues(b);
    return Array.from(b).map((x) => x.toString(36)).join("").slice(0, 9);
  } catch {
    return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  }
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => {
    const m = timers.current;
    return () => { for (const t of m.values()) clearTimeout(t); m.clear(); };
  }, []);
  const dismiss = (id: string) => {
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
    setToasts((p) => p.filter((x) => x.id !== id));
  };
  const push = (t: Omit<Toast, "id">) => {
    const id = makeToastId();
    setToasts((p) => [...p.slice(-3), { ...t, id }]);
    const timer = setTimeout(() => dismiss(id), 4500);
    timers.current.set(id, timer);
  };
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div {...stylex.props(s.region)} aria-live="polite" aria-atomic="true">
        {toasts.map((t) => (
          <div key={t.id} {...stylex.props(s.toast)} role="status">
            <span {...stylex.props(s.icon)} style={{ color: t.kind === "success" ? vars.good as string : t.kind === "error" ? vars.bad as string : vars.accent as string }}>
              {t.kind === "success" ? <Check size={16} /> : t.kind === "error" ? <AlertCircle size={16} /> : <Info size={16} />}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p {...stylex.props(s.title)}>{t.title}</p>
              {t.desc ? <p {...stylex.props(s.desc)}>{t.desc}</p> : null}
            </div>
            <button {...stylex.props(s.close)} aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <style>{`@keyframes toastIn{from{transform:translateY(8px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
    </ToastContext.Provider>
  );
}
