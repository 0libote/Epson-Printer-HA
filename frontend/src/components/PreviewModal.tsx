import * as stylex from "@stylexjs/stylex";
import { vars } from "../styles/tokens.stylex";
import { useEffect } from "react";
import { Download, X } from "lucide-react";
import type { ScanItem } from "../lib/api";
import { s as ui } from "./ui";

const s = stylex.create({
  meta: {
    fontFamily: vars.fontMono,
    fontSize: "11.5px",
    color: vars.textSecondary,
    marginBottom: "14px",
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
  },
  title: {
    fontFamily: vars.fontSans,
    fontSize: "15px",
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
    minWidth: 0,
  },
  head: { display: "flex", gap: "12px", alignItems: "center", marginBottom: "6px" },
  frame: {
    width: "100%",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.line,
    borderRadius: vars.radiusMd,
    backgroundColor: vars.bgSunken,
  },
});

export function PreviewModal({ scan, onClose }: { scan: ScanItem; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div {...stylex.props(ui.scrim)} role="dialog" aria-modal="true" aria-label={scan.name} onClick={onClose}>
      <div {...stylex.props(ui.modal)} onClick={(e) => e.stopPropagation()}>
        <div {...stylex.props(s.head)}>
          <span {...stylex.props(s.title)}>{scan.name}</span>
          <a href={`/scans/${encodeURIComponent(scan.name)}`} {...stylex.props(ui.buttonQuiet)} style={{ textDecoration: "none" }}>
            <Download size={13} /> Download
          </a>
          <button {...stylex.props(ui.buttonQuiet)} onClick={onClose} autoFocus aria-label="Close preview">
            <X size={14} />
          </button>
        </div>
        <div {...stylex.props(s.meta)}>
          <span>{scan.sizeDisplay}</span><span>·</span><span>{scan.mtimeIso}</span>
        </div>
        {scan.ext === ".pdf" ? (
          <iframe
            src={`/scans/${encodeURIComponent(scan.name)}?preview=1`}
            {...stylex.props(s.frame)}
            style={{ height: "60vh" }}
            title="PDF preview"
            loading="lazy"
          />
        ) : (
          <img
            src={`/scans/${encodeURIComponent(scan.name)}?preview=1`}
            alt={scan.name}
            {...stylex.props(s.frame)}
            style={{ height: "auto", maxHeight: "68vh", objectFit: "contain" }}
            loading="lazy"
          />
        )}
      </div>
    </div>
  );
}
