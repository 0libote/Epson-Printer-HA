import * as stylex from "@stylexjs/stylex";
import { vars } from "../styles/tokens.stylex";
import { useEffect, useState, createContext, useContext, type ReactNode } from "react";
import { Check, AlertCircle, X } from "lucide-react";

type Toast = { id: string; kind: "success" | "error" | "info"; title: string; desc?: string };
type ToastCtx = { push: (t: Omit<Toast, "id">) => void };

const ToastContext = createContext<ToastCtx>({ push: () => {} });
export const useToast = () => useContext(ToastContext);

const s = stylex.create({
  region: {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    zIndex: 9999,
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    pointerEvents: "none",
    maxWidth: "min(420px, calc(100vw - 24px))",
    width: "420px",
  },
  toast: {
    pointerEvents: "auto",
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    padding: "14px 14px",
    borderRadius: vars.radiusMd,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.line,
    backgroundColor: vars.panel,
    boxShadow: vars.shadowLg,
    animationName: "toastIn",
    animationDuration: "220ms",
    animationTimingFunction: "cubic-bezier(.2,.8,.2,1)",
  },
  toastSuccess: { borderColor: "#a7f3d0", backgroundColor: "#ecfdf5" },
  toastError: { borderColor: "#fecaca", backgroundColor: "#fef2f2" },
  icon: {
    flexShrink: 0,
    width: "28px",
    height: "28px",
    borderRadius: vars.radiusFull,
    display: "grid",
    placeItems: "center",
  },
  iconSuccess: { backgroundColor: vars.good, color: "white" },
  iconError: { backgroundColor: vars.bad, color: "white" },
  iconInfo: { backgroundColor: vars.blue, color: "white" },
  title: { margin: 0, fontSize: "13px", fontWeight: 700, color: vars.text, lineHeight: 1.35 },
  desc: { margin: "3px 0 0", fontSize: "12px", color: vars.textMuted, lineHeight: 1.4 },
  close: {
    marginLeft: "auto",
    backgroundColor: "transparent",
    borderWidth: 0,
    color: vars.textFaint,
    cursor: "pointer",
    padding: "4px",
    borderRadius: vars.radiusSm,
    display: "grid",
    placeItems: "center",
  },
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = (t: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2, 9);
    setToasts((p) => [...p, { ...t, id }]);
    setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), 4200);
  };
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div {...stylex.props(s.region)} aria-live="polite" aria-atomic="true">
        {toasts.map((t) => (
          <div key={t.id} {...stylex.props(s.toast, t.kind === "success" ? s.toastSuccess : t.kind === "error" ? s.toastError : undefined)} role="status">
            <span {...stylex.props(s.icon, t.kind === "success" ? s.iconSuccess : t.kind === "error" ? s.iconError : s.iconInfo)}>
              {t.kind === "success" ? <Check size={14} /> : <AlertCircle size={14} />}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p {...stylex.props(s.title)}>{t.title}</p>
              {t.desc ? <p {...stylex.props(s.desc)}>{t.desc}</p> : null}
            </div>
            <button {...stylex.props(s.close)} aria-label="Dismiss" onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <style>{`@keyframes toastIn{from{transform:translateY(8px) scale(.98);opacity:0}to{transform:none;opacity:1}}`}</style>
    </ToastContext.Provider>
  );
}
