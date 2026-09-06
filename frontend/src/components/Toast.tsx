import * as stylex from "@stylexjs/stylex";
import { vars } from "../styles/tokens.stylex";
import { useState, createContext, useContext, type ReactNode } from "react";
import { Check, AlertCircle, X } from "lucide-react";

type Toast = { id: string; kind: "success" | "error" | "info"; title: string; desc?: string };
type ToastCtx = { push: (t: Omit<Toast, "id">) => void };

const ToastContext = createContext<ToastCtx>({ push: () => {} });
export const useToast = () => useContext(ToastContext);

const s = stylex.create({
  region: {
    position: "fixed",
    bottom: "18px",
    right: "18px",
    zIndex: 9999,
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    pointerEvents: "none",
    maxWidth: "min(440px, calc(100vw - 24px))",
    width: "440px",
  },
  toast: {
    pointerEvents: "auto",
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    padding: "16px 14px",
    borderRadius: "16px",
    borderWidth: "3px",
    borderStyle: "solid",
    borderColor: vars.line,
    backgroundColor: "white",
    boxShadow: `6px 6px 0 ${vars.line}`,
    animationName: "toastIn",
    animationDuration: "220ms",
    animationTimingFunction: "cubic-bezier(.2,.8,.2,1)",
    transform: "rotate(0.4deg)",
  },
  toastSuccess: { backgroundColor: vars.lime, transform: "rotate(-0.4deg)" },
  toastError: { backgroundColor: vars.pink, color: "white" },
  icon: {
    flexShrink: 0,
    width: "32px",
    height: "32px",
    borderRadius: "10px",
    display: "grid",
    placeItems: "center",
    borderWidth: "2.5px",
    borderStyle: "solid",
    borderColor: vars.line,
    boxShadow: `2px 2px 0 ${vars.line}`,
    transform: "rotate(-2deg)",
  },
  iconSuccess: { backgroundColor: vars.text, color: vars.lime },
  iconError: { backgroundColor: "white", color: vars.bad },
  iconInfo: { backgroundColor: vars.yellow, color: vars.text },
  title: { margin: 0, fontFamily: `"Space Grotesk", sans-serif`, fontSize: "13px", fontWeight: 700, color: vars.text, lineHeight: 1.2, textTransform: "uppercase" },
  titleError: { color: "white" },
  desc: { margin: "4px 0 0", fontFamily: `"Fragment Mono", monospace`, fontSize: "11px", color: vars.text, opacity: 0.8, lineHeight: 1.4 },
  descError: { color: "white", opacity: 1 },
  close: {
    marginLeft: "auto",
    backgroundColor: "white",
    borderWidth: "2px",
    borderStyle: "solid",
    borderColor: vars.line,
    color: vars.text,
    cursor: "pointer",
    padding: "6px",
    borderRadius: "8px",
    display: "grid",
    placeItems: "center",
    boxShadow: `2px 2px 0 ${vars.line}`,
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
              {t.kind === "success" ? <Check size={16} strokeWidth={3} /> : <AlertCircle size={16} strokeWidth={2.5} />}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p {...stylex.props(s.title, t.kind === "error" ? s.titleError : undefined)}>{t.title}</p>
              {t.desc ? <p {...stylex.props(s.desc, t.kind === "error" ? s.descError : undefined)}>{t.desc}</p> : null}
            </div>
            <button {...stylex.props(s.close)} aria-label="Dismiss" onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))}>
              <X size={14} strokeWidth={2.5} />
            </button>
          </div>
        ))}
      </div>
      <style>{`@keyframes toastIn{from{transform:translateY(8px) rotate(-1deg) scale(.98);opacity:0}to{transform:translateY(0) rotate(0.4deg) scale(1);opacity:1}}`}</style>
    </ToastContext.Provider>
  );
}
