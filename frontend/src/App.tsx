import * as stylex from "@stylexjs/stylex";
import { vars } from "./styles/tokens.stylex";
import { useStatus, useHistory } from "./hooks/useStatus";
import { apiPostForm, ensureCsrf } from "./lib/api";
import { useToast } from "./components/Toast";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useRef, useMemo } from "react";
import {
  Printer,
  ScanLine,
  Upload,
  Copy,
  Check,
  Settings2,
  History,
  Wifi,
  WifiOff,
  FileText,
  Scan,
  Loader2,
  X,
  ChevronDown,
  ExternalLink,
  Search,
  Trash2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Zap,
  Sticker,
} from "lucide-react";

// ──────────────── PLAYFUL RETRO / NEUBRUTALIST STYLES ─────────────────
const s = stylex.create({
  page: {
    backgroundColor: vars.bg,
    // subtle warm dot grid + paper
    backgroundImage: `radial-gradient(#111 1px, transparent 1.5px)`,
    backgroundSize: `22px 22px`,
    backgroundPosition: `0 0`,
    color: vars.text,
    minHeight: "100vh",
    fontFamily: `"Space Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif`,
    lineHeight: 1.5,
    WebkitFontSmoothing: "antialiased",
  },
  pageInner: {
    // wash overlay to soften dots
    backgroundColor: "rgba(255,248,231,.92)",
    minHeight: "100vh",
  },
  topbar: {
    position: "sticky",
    top: 0,
    zIndex: 20,
    height: "72px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    paddingLeft: "max(16px, calc((100vw - 1160px)/2))",
    paddingRight: "max(16px, calc((100vw - 1160px)/2))",
    backgroundColor: vars.yellow,
    borderBottomWidth: "4px",
    borderBottomStyle: "solid",
    borderBottomColor: vars.line,
    // hard shadow under bar
    boxShadow: `0 4px 0 ${vars.line}`,
  },
  brand: {
    display: "inline-flex",
    alignItems: "center",
    gap: "12px",
    textDecoration: "none",
    color: vars.text,
  },
  brandMark: {
    width: "44px",
    height: "44px",
    borderRadius: "12px",
    display: "grid",
    placeItems: "center",
    backgroundColor: "white",
    borderWidth: "3px",
    borderStyle: "solid",
    borderColor: vars.line,
    color: vars.text,
    fontFamily: `"Space Grotesk", sans-serif`,
    fontWeight: 700,
    fontSize: "18px",
    boxShadow: `3px 3px 0 ${vars.line}`,
    transform: "rotate(-2deg)",
  },
  brandText: { display: "flex", flexDirection: "column", lineHeight: 1 },
  brandName: {
    fontFamily: `"Space Grotesk", sans-serif`,
    fontSize: "15px",
    fontWeight: 700,
    letterSpacing: "-.02em",
    textTransform: "uppercase",
  },
  brandSub: {
    fontFamily: `"Fragment Mono", monospace`,
    fontSize: "10px",
    color: vars.text,
    fontWeight: 500,
    marginTop: "2px",
    opacity: 0.8,
    letterSpacing: ".06em",
    textTransform: "uppercase",
  },
  health: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 14px",
    borderRadius: vars.radiusFull,
    borderWidth: "3px",
    borderStyle: "solid",
    borderColor: vars.line,
    backgroundColor: "white",
    fontFamily: `"Fragment Mono", monospace`,
    fontSize: "11px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: ".04em",
    boxShadow: `3px 3px 0 ${vars.line}`,
    whiteSpace: "nowrap",
  },
  healthOnline: { backgroundColor: vars.lime, color: vars.text },
  healthOffline: { backgroundColor: vars.pink, color: "white", borderColor: vars.line },
  healthSetup: { backgroundColor: vars.yellow, color: vars.text },
  healthDot: {
    width: "10px",
    height: "10px",
    borderRadius: vars.radiusFull,
    backgroundColor: vars.text,
    borderWidth: "2px",
    borderStyle: "solid",
    borderColor: vars.line,
  },
  dotOnline: { backgroundColor: vars.good },
  dotOffline: { backgroundColor: "white" },
  dotWarn: { backgroundColor: vars.warn },

  shell: {
    width: "min(1160px, calc(100% - 32px))",
    marginLeft: "auto",
    marginRight: "auto",
    paddingTop: "28px",
    paddingBottom: "40px",
    "@media (max-width: 640px)": { width: "min(1160px, calc(100% - 20px))", paddingTop: "18px" },
  },
  intro: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: "20px",
    marginBottom: "20px",
    "@media (max-width: 820px)": { flexDirection: "column", alignItems: "flex-start" },
  },
  kicker: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    margin: 0,
    color: "white",
    backgroundColor: vars.text,
    padding: "6px 10px",
    borderRadius: vars.radiusFull,
    fontFamily: `"Fragment Mono", monospace`,
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: ".08em",
    textTransform: "uppercase",
    borderWidth: "2px",
    borderStyle: "solid",
    borderColor: vars.line,
    boxShadow: `2px 2px 0 ${vars.line}`,
    transform: "rotate(-1deg)",
  },
  h1: {
    margin: "10px 0 0",
    fontFamily: `"Space Grotesk", sans-serif`,
    fontSize: "clamp(32px, 5vw, 48px)",
    lineHeight: 0.95,
    letterSpacing: "-.04em",
    fontWeight: 700,
    // brutalist offset shadow via textShadow
    textShadow: `3px 3px 0 ${vars.yellow}`,
  },
  sub: {
    margin: "14px 0 0",
    color: vars.text,
    fontSize: "15px",
    maxWidth: "560px",
    lineHeight: 1.45,
    fontWeight: 500,
    backgroundColor: "white",
    display: "inline-block",
    padding: "8px 12px",
    borderWidth: "2.5px",
    borderStyle: "solid",
    borderColor: vars.line,
    borderRadius: vars.radiusMd,
    boxShadow: `4px 4px 0 ${vars.line}`,
    transform: "rotate(0.3deg)",
    "@media (max-width:640px)": { fontSize: "13px" },
  },
  chips: { display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "flex-end", "@media (max-width:820px)": { justifyContent: "flex-start" } },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 14px",
    borderRadius: vars.radiusFull,
    borderWidth: "2.5px",
    borderStyle: "solid",
    borderColor: vars.line,
    backgroundColor: "white",
    fontFamily: `"Fragment Mono", monospace`,
    fontSize: "11px",
    fontWeight: 700,
    color: vars.text,
    boxShadow: `3px 3px 0 ${vars.line}`,
    transform: "rotate(0.5deg)",
  },
  chipDot: { width: "9px", height: "9px", borderRadius: vars.radiusFull, borderWidth: "2px", borderStyle: "solid", borderColor: vars.line, backgroundColor: vars.text },

  grid2: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "22px",
    "@media (max-width: 860px)": { gridTemplateColumns: "1fr" },
  },
  card: {
    backgroundColor: vars.panel,
    borderWidth: "3px",
    borderStyle: "solid",
    borderColor: vars.line,
    borderRadius: vars.radiusXl,
    boxShadow: `6px 6px 0 ${vars.line}`,
    overflow: "hidden",
  },
  cardPad: { padding: "22px", "@media (max-width:640px)": { padding: "18px" } },
  taskHead: { display: "flex", gap: "14px", alignItems: "center", marginBottom: "16px" },
  taskIcon: {
    width: "52px",
    height: "52px",
    borderRadius: "14px",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    borderWidth: "3px",
    borderStyle: "solid",
    borderColor: vars.line,
    boxShadow: `3px 3px 0 ${vars.line}`,
    transform: "rotate(-2deg)",
  },
  taskIconPrint: { backgroundColor: vars.yellow, color: vars.text },
  taskIconScan: { backgroundColor: vars.lilac, color: "white" },
  cardTitle: {
    margin: 0,
    fontFamily: `"Space Grotesk", sans-serif`,
    fontSize: "20px",
    fontWeight: 700,
    letterSpacing: "-.02em",
    lineHeight: 1,
  },
  cardKicker: {
    margin: "0 0 4px",
    fontFamily: `"Fragment Mono", monospace`,
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: ".09em",
    textTransform: "uppercase",
    color: vars.text,
    backgroundColor: vars.yellow,
    display: "inline-block",
    padding: "3px 8px",
    borderRadius: vars.radiusFull,
    borderWidth: "1.5px",
    borderStyle: "solid",
    borderColor: vars.line,
  },
  cardKickerTeal: { backgroundColor: vars.lilac, color: "white" },

  filePicker: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "14px",
    minHeight: "132px",
    padding: "18px",
    borderWidth: "3px",
    borderStyle: "dashed",
    borderColor: vars.line,
    borderRadius: "18px",
    backgroundColor: "#FFF9E7",
    cursor: "pointer",
    transition: "transform .1s, background .15s",
    textAlign: "left",
    transform: "rotate(-0.3deg)",
    ":hover": { backgroundColor: vars.bgSubtle, transform: "rotate(0deg) scale(1.005)" },
  },
  filePickerActive: { backgroundColor: vars.yellow, transform: "rotate(0.5deg) scale(1.01)", borderColor: vars.line },
  filePickerInput: { position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" },
  fileGlyph: {
    width: "44px",
    height: "44px",
    borderRadius: "12px",
    display: "grid",
    placeItems: "center",
    backgroundColor: vars.yellow,
    borderWidth: "3px",
    borderStyle: "solid",
    borderColor: vars.line,
    color: vars.text,
    boxShadow: `3px 3px 0 ${vars.line}`,
    flexShrink: 0,
    transform: "rotate(-3deg)",
  },
  fileStrong: { display: "block", fontFamily: `"Space Grotesk", sans-serif`, fontSize: "15px", fontWeight: 700, color: vars.text, lineHeight: 1 },
  fileSmall: { display: "block", fontFamily: `"Fragment Mono", monospace`, fontSize: "11px", color: vars.text, opacity: 0.7, marginTop: "4px" },
  selectedFile: {
    marginTop: "12px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    padding: "12px 14px",
    borderRadius: vars.radiusMd,
    backgroundColor: "white",
    borderWidth: "2.5px",
    borderStyle: "solid",
    borderColor: vars.line,
    boxShadow: `3px 3px 0 ${vars.line}`,
    fontFamily: `"Fragment Mono", monospace`,
    fontSize: "12px",
    transform: "rotate(0.3deg)",
  },
  error: {
    marginTop: "12px",
    padding: "12px 14px",
    borderRadius: vars.radiusMd,
    backgroundColor: vars.bad,
    borderWidth: "3px",
    borderStyle: "solid",
    borderColor: vars.line,
    color: "white",
    fontFamily: `"Fragment Mono", monospace`,
    fontSize: "12px",
    fontWeight: 700,
    display: "flex",
    gap: "8px",
    alignItems: "center",
    boxShadow: `3px 3px 0 ${vars.line}`,
    transform: "rotate(-0.5deg)",
  },
  optionsRow: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-end",
    marginTop: "14px",
    "@media (max-width:560px)": { flexDirection: "column", alignItems: "stretch" },
  },
  fieldLabel: {
    display: "block",
    fontFamily: `"Fragment Mono", monospace`,
    fontSize: "10px",
    fontWeight: 700,
    color: vars.text,
    flex: "0 0 auto",
    textTransform: "uppercase",
    letterSpacing: ".06em",
  },
  input: {
    width: "100%",
    minHeight: "44px",
    marginTop: "6px",
    padding: "10px 14px",
    borderRadius: "12px",
    borderWidth: "2.5px",
    borderStyle: "solid",
    borderColor: vars.line,
    backgroundColor: "white",
    color: vars.text,
    fontFamily: `"Space Grotesk", sans-serif`,
    fontSize: "14px",
    fontWeight: 700,
    outlineWidth: "0px",
    boxShadow: `2px 2px 0 ${vars.line}`,
    ":focus": { backgroundColor: "#FFFDE7", transform: "translate(-1px, -1px)", boxShadow: `3px 3px 0 ${vars.line}` },
  },
  inputCompact: { width: "110px", "@media (max-width:560px)": { width: "100%" } },
  check: {
    display: "inline-flex",
    alignItems: "center",
    gap: "9px",
    padding: "0 14px",
    minHeight: "44px",
    borderRadius: "12px",
    borderWidth: "2.5px",
    borderStyle: "solid",
    borderColor: vars.line,
    backgroundColor: "white",
    fontFamily: `"Space Grotesk", sans-serif`,
    fontSize: "13px",
    fontWeight: 700,
    color: vars.text,
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
    boxShadow: `2px 2px 0 ${vars.line}`,
  },
  buttonPrimary: {
    width: "100%",
    minHeight: "50px",
    borderWidth: "3px",
    borderStyle: "solid",
    borderColor: vars.line,
    borderRadius: "14px",
    backgroundColor: vars.yellow,
    color: vars.text,
    fontFamily: `"Space Grotesk", sans-serif`,
    fontWeight: 700,
    fontSize: "15px",
    letterSpacing: "-.01em",
    textTransform: "uppercase",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    boxShadow: `4px 4px 0 ${vars.line}`,
    transition: "transform .08s, box-shadow .08s",
    ":hover": { transform: "translate(-1px, -1px)", boxShadow: `5px 5px 0 ${vars.line}` },
    ":active": { transform: "translate(2px, 2px)", boxShadow: `2px 2px 0 ${vars.line}` },
    ":disabled": { opacity: 0.6, cursor: "wait", transform: "none" },
  },
  buttonTeal: {
    backgroundColor: vars.teal,
    color: "white",
    borderColor: vars.line,
    ":hover": { backgroundColor: vars.tealDark },
  },
  buttonYellow: { backgroundColor: vars.yellow },
  buttonBlue: { backgroundColor: vars.blue, color: "white" },
  buttonPink: { backgroundColor: vars.pink, color: "white" },
  buttonQuiet: {
    borderWidth: "2.5px",
    borderStyle: "solid",
    borderColor: vars.line,
    borderRadius: "10px",
    padding: "8px 12px",
    fontFamily: `"Fragment Mono", monospace`,
    fontSize: "11px",
    fontWeight: 700,
    cursor: "pointer",
    backgroundColor: "white",
    color: vars.text,
    boxShadow: `2px 2px 0 ${vars.line}`,
    transition: "transform .08s",
    textTransform: "uppercase",
    ":hover": { backgroundColor: vars.yellow, transform: "translate(-1px, -1px)" },
    ":active": { transform: "translate(1px, 1px)", boxShadow: `1px 1px 0 ${vars.line}` },
  },
  buttonDanger: { backgroundColor: vars.bad, color: "white", ":hover": { backgroundColor: "#E03A30" } },

  progress: { height: "10px", backgroundColor: "white", borderRadius: vars.radiusFull, overflow: "hidden", borderWidth: "2.5px", borderStyle: "solid", borderColor: vars.line, boxShadow: `2px 2px 0 ${vars.line}` },
  progressBar: {
    height: "100%",
    width: "36%",
    borderRadius: "inherit",
    backgroundColor: vars.text,
    animationName: "indeterminate",
    animationDuration: "1.1s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  },
  progressBarTeal: { backgroundColor: vars.pink },
  opCopy: { display: "flex", justifyContent: "space-between", gap: "10px", marginTop: "8px", fontFamily: `"Fragment Mono", monospace`, fontSize: "10px", fontWeight: 700, color: vars.text, textTransform: "uppercase" },
  opCopyStrong: { fontWeight: 700, color: vars.text },
  scanOptions: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0,1fr))",
    gap: "10px",
    "@media (max-width:560px)": { gridTemplateColumns: "1fr 1fr" },
  },
  helpText: { margin: "12px 0", color: vars.text, opacity: 0.7, fontFamily: `"Fragment Mono", monospace`, fontSize: "11px", lineHeight: 1.5 },
  emptyScan: {
    minHeight: "220px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    padding: "18px",
    borderRadius: "16px",
    backgroundColor: vars.warnSoft,
    borderWidth: "3px",
    borderStyle: "solid",
    borderColor: vars.line,
    boxShadow: `4px 4px 0 ${vars.line}`,
    transform: "rotate(0.4deg)",
  },
  statusStrip: {
    marginTop: "22px",
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0,1fr))",
    overflow: "hidden",
    borderWidth: "3px",
    borderStyle: "solid",
    borderColor: vars.line,
    borderRadius: "18px",
    boxShadow: `6px 6px 0 ${vars.line}`,
    backgroundColor: "white",
    "@media (max-width:820px)": { gridTemplateColumns: "1fr" },
  },
  deviceCell: {
    display: "grid",
    gridTemplateColumns: "auto auto minmax(0,1fr)",
    alignItems: "center",
    gap: "10px",
    padding: "16px 18px",
    borderRightWidth: "3px",
    borderRightStyle: "solid",
    borderRightColor: vars.line,
    "@media (max-width:820px)": {
      borderRightWidth: 0,
      borderBottomWidth: "3px",
      borderBottomStyle: "solid",
      borderBottomColor: vars.line,
    },
  },
  deviceLabelSmall: {
    display: "block",
    fontFamily: `"Fragment Mono", monospace`,
    fontSize: "9px",
    fontWeight: 700,
    letterSpacing: ".08em",
    textTransform: "uppercase",
    color: vars.text,
    opacity: 0.6,
    lineHeight: 1.2,
  },
  deviceLabelStrong: { display: "block", fontFamily: `"Space Grotesk", sans-serif`, fontSize: "13px", fontWeight: 700, lineHeight: 1.1 },
  deviceDetail: {
    fontFamily: `"Fragment Mono", monospace`,
    fontSize: "10px",
    color: vars.text,
    opacity: 0.6,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textAlign: "right",
  },
  live: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginTop: "14px",
    fontFamily: `"Fragment Mono", monospace`,
    fontSize: "11px",
    fontWeight: 700,
    color: vars.text,
    textTransform: "uppercase",
  },
  liveDot: { width: "10px", height: "10px", borderRadius: vars.radiusFull, backgroundColor: vars.good, borderWidth: "2px", borderStyle: "solid", borderColor: vars.line, boxShadow: `1px 1px 0 ${vars.line}` },
  liveDotError: { backgroundColor: vars.bad },
  activityGrid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: "22px", marginTop: "18px", "@media (max-width:860px)": { gridTemplateColumns: "1fr" } },
  compactHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "14px" },
  sectionKicker: {
    fontFamily: `"Fragment Mono", monospace`,
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: ".08em",
    textTransform: "uppercase",
    backgroundColor: vars.text,
    color: "white",
    padding: "4px 8px",
    borderRadius: vars.radiusFull,
    display: "inline-block",
  },
  itemList: { borderTopWidth: "3px", borderTopStyle: "solid", borderTopColor: vars.line },
  itemRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "14px 0",
    borderBottomWidth: "2px",
    borderBottomStyle: "solid",
    borderBottomColor: vars.line,
    textDecoration: "none",
    color: vars.text,
  },
  downloadLink: {
    fontFamily: `"Fragment Mono", monospace`,
    fontSize: "11px",
    fontWeight: 700,
    color: "white",
    backgroundColor: vars.text,
    padding: "6px 10px",
    borderRadius: vars.radiusFull,
    borderWidth: "2px",
    borderStyle: "solid",
    borderColor: vars.line,
    boxShadow: `2px 2px 0 ${vars.line}`,
  },
  fold: {
    marginTop: "18px",
    overflow: "hidden",
    backgroundColor: "white",
    borderWidth: "3px",
    borderStyle: "solid",
    borderColor: vars.line,
    borderRadius: "18px",
    boxShadow: `6px 6px 0 ${vars.line}`,
  },
  foldSummary: {
    minHeight: "68px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "14px",
    padding: "16px 20px",
    cursor: "pointer",
    listStyle: "none",
  },
  foldTitle: { fontFamily: `"Space Grotesk", sans-serif`, fontSize: "15px", fontWeight: 700 },
  foldSub: { fontFamily: `"Fragment Mono", monospace`, fontSize: "11px", color: vars.text, opacity: 0.6, marginTop: "3px" },
  foldBadge: {
    fontFamily: `"Fragment Mono", monospace`,
    fontSize: "10px",
    fontWeight: 700,
    padding: "6px 12px",
    borderRadius: vars.radiusFull,
    backgroundColor: "white",
    color: vars.text,
    borderWidth: "2.5px",
    borderStyle: "solid",
    borderColor: vars.line,
    boxShadow: `2px 2px 0 ${vars.line}`,
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
  foldBadgeOn: { backgroundColor: vars.lime, transform: "rotate(1deg)" },
  foldBadgeOff: { backgroundColor: vars.badSoft, transform: "rotate(-1deg)" },
  foldContent: {
    borderTopWidth: "3px",
    borderTopStyle: "solid",
    borderTopColor: vars.line,
    backgroundColor: "#FFF8E7",
    padding: "22px",
    "@media (max-width:640px)": { padding: "16px" },
  },
  networkGrid: { display: "grid", gridTemplateColumns: "minmax(0,.9fr) minmax(0,1.1fr)", gap: "28px", "@media (max-width:860px)": { gridTemplateColumns: "1fr" } },
  stack: { display: "grid", gap: "14px" },
  toggle: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    padding: "14px",
    borderRadius: "14px",
    borderWidth: "2.5px",
    borderStyle: "solid",
    borderColor: vars.line,
    backgroundColor: "white",
    cursor: "pointer",
    boxShadow: `3px 3px 0 ${vars.line}`,
    transform: "rotate(-0.2deg)",
  },
  codeBox: {
    flex: "1 1 auto",
    minWidth: 0,
    padding: "12px 14px",
    borderRadius: "12px",
    borderWidth: "2.5px",
    borderStyle: "solid",
    borderColor: vars.line,
    backgroundColor: "white",
    fontFamily: `"Fragment Mono", monospace`,
    fontSize: "11px",
    overflowX: "auto",
    whiteSpace: "nowrap",
    boxShadow: `2px 2px 0 ${vars.line}`,
  },
  welcome: {
    maxWidth: "760px",
    marginLeft: "auto",
    marginRight: "auto",
    marginTop: "40px",
    overflow: "hidden",
    backgroundColor: "white",
    borderWidth: "4px",
    borderStyle: "solid",
    borderColor: vars.line,
    borderRadius: "26px",
    boxShadow: `8px 8px 0 ${vars.line}`,
    transform: "rotate(-0.5deg)",
  },
  welcomeCopy: {
    padding: "32px",
    backgroundColor: vars.yellow,
    borderBottomWidth: "4px",
    borderBottomStyle: "solid",
    borderBottomColor: vars.line,
    position: "relative",
    // confetti dots
    backgroundImage: `radial-gradient(#111 1.5px, transparent 1.5px)`,
    backgroundSize: `18px 18px`,
  },
  welcomeCopyInner: {
    backgroundColor: "white",
    padding: "16px 18px",
    borderWidth: "3px",
    borderStyle: "solid",
    borderColor: vars.line,
    borderRadius: "16px",
    boxShadow: `4px 4px 0 ${vars.line}`,
    transform: "rotate(0.6deg)",
    display: "inline-block",
  },
  stepPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 12px",
    borderRadius: vars.radiusFull,
    backgroundColor: vars.pink,
    color: "white",
    borderWidth: "2.5px",
    borderStyle: "solid",
    borderColor: vars.line,
    fontFamily: `"Fragment Mono", monospace`,
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: ".05em",
    textTransform: "uppercase",
    boxShadow: `2px 2px 0 ${vars.line}`,
    transform: "rotate(-1.5deg)",
  },
  fieldAction: { display: "grid", gridTemplateColumns: "1fr auto", gap: "12px", "@media (max-width:560px)": { gridTemplateColumns: "1fr" } },
  skeleton: { backgroundColor: "white", borderWidth: "3px", borderStyle: "solid", borderColor: vars.line, borderRadius: "12px", boxShadow: `3px 3px 0 ${vars.line}`, animationName: "pulse", animationDuration: "1.4s", animationIterationCount: "infinite" },
  footer: {
    padding: "32px 16px 36px",
    textAlign: "center",
    color: vars.text,
    opacity: 0.5,
    fontFamily: `"Fragment Mono", monospace`,
    fontSize: "10px",
    textTransform: "uppercase",
    letterSpacing: ".06em",
  },
  sticker: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "4px 10px",
    backgroundColor: vars.lilac,
    color: "white",
    borderWidth: "2px",
    borderStyle: "solid",
    borderColor: vars.line,
    borderRadius: vars.radiusFull,
    fontFamily: `"Fragment Mono", monospace`,
    fontSize: "10px",
    fontWeight: 700,
    boxShadow: `2px 2px 0 ${vars.line}`,
    transform: "rotate(-1deg)",
  },
});

function useCopy() {
  const { push } = useToast();
  return async (text: string, label = "Copied") => {
    try {
      await navigator.clipboard.writeText(text);
      push({ kind: "success", title: label, desc: text.slice(0, 80) });
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); ta.remove();
      push({ kind: "success", title: label });
    }
  };
}

function HealthBadge({ reachable, printerIp }: { reachable: boolean; printerIp: string }) {
  if (!printerIp) return <span {...stylex.props(s.health, s.healthSetup)}><span {...stylex.props(s.healthDot, s.dotWarn)} />SETUP NEEDED</span>;
  if (reachable) return <span {...stylex.props(s.health, s.healthOnline)}><span {...stylex.props(s.healthDot, s.dotOnline)} />● ONLINE</span>;
  return <span {...stylex.props(s.health, s.healthOffline)}><span {...stylex.props(s.healthDot, s.dotOffline)} />NEEDS ATTENTION</span>;
}

function Dot({ ok, warn }: { ok?: boolean; warn?: boolean }) {
  return <span {...stylex.props(s.chipDot, ok ? undefined : warn ? undefined : undefined)} style={{ width: 9, height: 9, borderRadius: 999, background: ok ? "#00C950" : warn ? "#FF9F1C" : "#111", border: "2px solid #111" }} aria-hidden="true" />;
}

export default function App() {
  const { data, isLoading, isError, error, refetch } = useStatus(true);
  const historyQ = useHistory(100);
  const qc = useQueryClient();
  const { push } = useToast();
  const copy = useCopy();

  const printerIp = data?.printer_ip || "";
  const printerName = data?.printer_name || "Home_Epson_XP2200";
  const displayName = data?.display_name || "Home Epson XP-2200";
  const reachable = !!data?.reachable;
  const printer = data?.printer || { ok: false, state: "setup_required", detail: "" };
  const scanner = data?.scanner || { ok: false, state: "starting", detail: "", backend: null };
  const queue = data?.queue || [];
  const scans = data?.scans || [];
  const networkSharing = !!data?.network_sharing;

  const host = useMemo(() => {
    const h = window.location.host;
    if (h.startsWith("[")) return h.split("]")[0] + "]";
    return h.split(":")[0] || "localhost";
  }, []);
  const ippUri = `ipp://${host}:631/printers/${printerName}`;
  const httpUri = `http://${host}:631/printers/${printerName}`;

  const [setupIp, setSetupIp] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupStage, setSetupStage] = useState(0);
  const setupStages = ["Checking the printer address", "Configuring the print service", "Waiting for the printer to respond"];

  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [copies, setCopies] = useState(1);
  const [grayscale, setGrayscale] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [printStage, setPrintStage] = useState(0);
  const [printError, setPrintError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const MAX_MB = 128;
  const printStages = ["Uploading the file", "Preparing the print job", "Waiting for the printer queue"];

  const [scanMode, setScanMode] = useState("Color");
  const [scanDpi, setScanDpi] = useState("300");
  const [scanFmt, setScanFmt] = useState("pdf");
  const [scanBusy, setScanBusy] = useState(false);
  const [scanStage, setScanStage] = useState(0);
  const scanStages = ["Contacting the scanner", "Scanning the document", "Preparing the download"];
  const scanStageSeconds = 15;

  const [displayNameEdit, setDisplayNameEdit] = useState(displayName);
  const [queueNameEdit, setQueueNameEdit] = useState(printerName);
  const [shareEdit, setShareEdit] = useState(networkSharing);
  const [netBusy, setNetBusy] = useState(false);
  const [netStage, setNetStage] = useState(0);
  const netStages = ["Validating the settings", "Updating the print queue", "Refreshing network sharing"];
  useEffect(() => { setDisplayNameEdit(displayName); setQueueNameEdit(printerName); setShareEdit(networkSharing); }, [displayName, printerName, networkSharing]);

  const [historyFilter, setHistoryFilter] = useState("");
  const [showAllHistory, setShowAllHistory] = useState(false);
  const history = historyQ.data?.history || [];
  const filteredHistory = useMemo(() => {
    if (!historyFilter.trim()) return history;
    const q = historyFilter.toLowerCase();
    return history.filter(h => `${h.document} ${h.source} ${h.state} ${h.user_name || ""} ${h.origin_host || ""}`.toLowerCase().includes(q));
  }, [history, historyFilter]);
  const visibleHistory = showAllHistory ? filteredHistory : filteredHistory.slice(0, 30);

  const [changeIp, setChangeIp] = useState(printerIp);
  useEffect(() => setChangeIp(printerIp), [printerIp]);

  useEffect(() => { if (!setupBusy) return; const id = setInterval(() => setSetupStage(s => Math.min(s + 1, setupStages.length - 1)), 8000); return () => clearInterval(id); }, [setupBusy]);
  useEffect(() => { if (!printBusy) return; const id = setInterval(() => setPrintStage(s => Math.min(s + 1, printStages.length - 1)), 9000); return () => clearInterval(id); }, [printBusy]);
  useEffect(() => { if (!scanBusy) return; const id = setInterval(() => setScanStage(s => Math.min(s + 1, scanStages.length - 1)), scanStageSeconds * 1000); return () => clearInterval(id); }, [scanBusy]);
  useEffect(() => { if (!netBusy) return; const id = setInterval(() => setNetStage(s => Math.min(s + 1, netStages.length - 1)), 7000); return () => clearInterval(id); }, [netBusy]);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    const ip = setupIp.trim();
    if (!ip) return;
    const parts = ip.split(".");
    if (parts.length !== 4 || parts.some(p => !/^\d+$/.test(p) || Number(p) < 0 || Number(p) > 255)) { push({ kind: "error", title: "Use the printer's normal IPv4 address" }); return; }
    setSetupBusy(true); setSetupStage(0);
    try {
      await ensureCsrf();
      const fd = new FormData(); fd.set("printer_ip", ip);
      const csrf = await ensureCsrf(); fd.set("_csrf_token", csrf);
      const res = await fetch("/setup", { method: "POST", body: fd, credentials: "same-origin", headers: { "X-CSRF-Token": csrf, Accept: "application/json" } });
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) { const j = await res.json(); if (!res.ok) throw new Error(j.error || j.message || "Setup failed"); push({ kind: "success", title: `Printer saved at ${ip}`, desc: "CUPS is configured." }); }
      else { const txt = await res.text(); if (txt.toLowerCase().includes("error") && txt.toLowerCase().includes("cups")) { const m = txt.match(/class="notice error"[\s\S]*?>([\s\S]*?)<\/div>/); throw new Error(m ? m[1].replace(/<[^>]+>/g, "").trim().slice(0, 180) : "CUPS setup failed"); } push({ kind: "success", title: `Printer saved at ${ip}`, desc: "CUPS is configured." }); }
      await qc.invalidateQueries({ queryKey: ["status"] }); await qc.invalidateQueries({ queryKey: ["history"] });
    } catch (err: any) { push({ kind: "error", title: "Could not save printer", desc: String(err.message || err).slice(0, 220) }); } finally { setSetupBusy(false); }
  };

  const handlePrint = async (e: React.FormEvent) => {
    e.preventDefault(); setPrintError(null);
    if (!file) { setPrintError("Choose a file first."); return; }
    const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
    if (![".pdf", ".png", ".jpg", ".jpeg", ".txt"].includes(ext)) { setPrintError("Supported files: PDF, PNG, JPG and TXT."); return; }
    if (file.size === 0) { setPrintError("The selected file is empty."); return; }
    if (file.size > MAX_MB * 1024 * 1024) { setPrintError(`That file is too large. The limit is ${MAX_MB} MB.`); return; }
    if (copies < 1 || copies > 99) { setPrintError("Copies must be between 1 and 99."); return; }
    setPrintBusy(true); setPrintStage(0);
    try {
      const fd = new FormData(); fd.set("file", file); fd.set("copies", String(copies)); if (grayscale) fd.set("grayscale", "on");
      await apiPostForm("/print", fd);
      push({ kind: "success", title: "File added to the print queue", desc: `${file.name} · ${copies} ${copies === 1 ? "copy" : "copies"}` });
      setFile(null); if (fileRef.current) fileRef.current.value = "";
      await qc.invalidateQueries({ queryKey: ["status"] }); await qc.invalidateQueries({ queryKey: ["history"] });
    } catch (err: any) { const msg = String(err.message || err); setPrintError(msg.slice(0, 260)); push({ kind: "error", title: "Print failed", desc: msg.slice(0, 200) }); } finally { setPrintBusy(false); }
  };

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!["150", "200", "300", "600"].includes(scanDpi)) { push({ kind: "error", title: "DPI must be 150, 200, 300 or 600." }); return; }
    setScanBusy(true); setScanStage(0);
    try {
      const fd = new FormData(); fd.set("dpi", scanDpi); fd.set("mode", scanMode); fd.set("format", scanFmt);
      await apiPostForm("/scan", fd);
      push({ kind: "success", title: "Scan complete", desc: `Saved as ${scanFmt.toUpperCase()} · ${scanDpi} dpi` });
      await qc.invalidateQueries({ queryKey: ["status"] });
    } catch (err: any) {
      const msg = String(err.message || err);
      if (msg.toLowerCase().includes("already in progress")) push({ kind: "error", title: "Scan already in progress", desc: "Wait for it to finish before starting another." });
      else push({ kind: "error", title: "Scan failed", desc: msg.slice(0, 220) });
    } finally { setScanBusy(false); }
  };

  const handleNetworkSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayNameEdit.trim() || displayNameEdit.trim().length > 80) { push({ kind: "error", title: "Display name must be 1-80 characters" }); return; }
    if (!/^[A-Za-z0-9._-]{1,127}$/.test(queueNameEdit.trim())) { push({ kind: "error", title: "Queue name may only contain letters, numbers, dot, dash and underscore" }); return; }
    setNetBusy(true); setNetStage(0);
    try {
      const fd = new FormData(); fd.set("display_name", displayNameEdit.trim()); fd.set("printer_name", queueNameEdit.trim()); if (shareEdit) fd.set("share_printer", "on");
      await apiPostForm("/client-settings", fd);
      push({ kind: "success", title: "Network sharing settings applied" });
      await qc.invalidateQueries({ queryKey: ["status"] });
    } catch (err: any) { push({ kind: "error", title: "Could not save sharing settings", desc: String(err.message || err).slice(0, 220) }); } finally { setNetBusy(false); }
  };

  const handleChangeIp = async (e: React.FormEvent) => {
    e.preventDefault(); const ip = changeIp.trim(); if (!ip) return;
    setSetupBusy(true); setSetupStage(0);
    try { const fd = new FormData(); fd.set("printer_ip", ip); await apiPostForm("/setup", fd); push({ kind: "success", title: `Printer address updated`, desc: ip }); await qc.invalidateQueries({ queryKey: ["status"] }); }
    catch (err: any) { push({ kind: "error", title: "Could not update address", desc: String(err.message || err).slice(0, 220) }); } finally { setSetupBusy(false); }
  };

  const handleCancel = async (jobId: string) => {
    try { const fd = new FormData(); await apiPostForm(`/jobs/${encodeURIComponent(jobId)}/cancel`, fd); push({ kind: "success", title: "Job cancelled", desc: jobId }); await qc.invalidateQueries({ queryKey: ["status"] }); await qc.invalidateQueries({ queryKey: ["history"] }); }
    catch (err: any) { push({ kind: "error", title: "Could not cancel job", desc: String(err.message || err).slice(0, 200) }); }
  };

  const onFile = (f: File | null) => {
    setPrintError(null);
    if (!f) { setFile(null); return; }
    const ext = "." + (f.name.split(".").pop() || "").toLowerCase();
    if (![".pdf", ".png", ".jpg", ".jpeg", ".txt"].includes(ext)) { setPrintError("Supported files: PDF, PNG, JPG and TXT."); setFile(null); return; }
    if (f.size > MAX_MB * 1024 * 1024) { setPrintError(`That file is too large. The limit is ${MAX_MB} MB.`); setFile(null); return; }
    if (f.size === 0) { setPrintError("The selected file is empty."); setFile(null); return; }
    setFile(f);
  };

  if (isLoading) {
    return (
      <div {...stylex.props(s.page)}><div {...stylex.props(s.pageInner)}>
        <nav {...stylex.props(s.topbar)}><a {...stylex.props(s.brand)} href="/"><span {...stylex.props(s.brandMark)}>P</span><span {...stylex.props(s.brandText)}><strong {...stylex.props(s.brandName)}>HOME PRINT HUB</strong><small {...stylex.props(s.brandSub)}>Epson XP-2200 • Homelab Edition</small></span></a><span {...stylex.props(s.skeleton)} style={{ width: 120, height: 36 }} /></nav>
        <main {...stylex.props(s.shell)}>
          <div {...stylex.props(s.skeleton)} style={{ height: 18, width: 180, marginBottom: 10 }} />
          <div {...stylex.props(s.skeleton)} style={{ height: 48, width: 520, maxWidth: "100%", marginBottom: 20 }} />
          <div {...stylex.props(s.grid2)}><div {...stylex.props(s.card, s.cardPad)} style={{ minHeight: 340 }}><div {...stylex.props(s.skeleton)} style={{ height: 300 }} /></div><div {...stylex.props(s.card, s.cardPad)} style={{ minHeight: 340 }}><div {...stylex.props(s.skeleton)} style={{ height: 300 }} /></div></div>
        </main>
      </div><style>{`@keyframes pulse{0%,100%{opacity:.7}50%{opacity:.4}} @keyframes indeterminate{from{transform:translateX(-110%)}to{transform:translateX(305%)}}`}</style></div>
    );
  }

  if (isError) {
    const msg = (error as any)?.message || "";
    const isAuth = msg.includes("401") || msg.toLowerCase().includes("authentication");
    return (
      <div {...stylex.props(s.page)}><div {...stylex.props(s.pageInner)}>
        <nav {...stylex.props(s.topbar)}><a {...stylex.props(s.brand)} href="/"><span {...stylex.props(s.brandMark)}>P</span><span {...stylex.props(s.brandText)}><strong {...stylex.props(s.brandName)}>HOME PRINT HUB</strong><small {...stylex.props(s.brandSub)}>Epson XP-2200</small></span></a><span {...stylex.props(s.health, s.healthSetup)}><ShieldAlert size={14} /> PRIVATE</span></nav>
        <main {...stylex.props(s.shell)}><div {...stylex.props(s.card, s.cardPad)} style={{ maxWidth: 560, margin: "40px auto", textAlign: "center", background: "white" }}><div style={{ width: 64, height: 64, borderRadius: 16, display: "grid", placeItems: "center", background: vars.bad, color: "white", margin: "0 auto 16px", border: "3px solid #111", boxShadow: `4px 4px 0 #111`, transform: "rotate(-2deg)" }}><ShieldAlert size={28} /></div><h1 style={{ fontFamily: `"Space Grotesk", sans-serif`, fontSize: 24, fontWeight: 700, margin: 0 }}>{isAuth ? "Authentication required" : "Could not reach Home Print Hub"}</h1><p style={{ fontFamily: `"Fragment Mono", monospace`, fontSize: 12, marginTop: 8, opacity: .7 }}>{isAuth ? "Check WEB_USERNAME / WEB_PASSWORD." : msg || "Network unavailable."}</p><button {...stylex.props(s.buttonPrimary)} style={{ marginTop: 18, width: "auto", padding: "12px 22px" }} onClick={() => refetch()}><RefreshCw size={16} /> RETRY</button></div></main>
      </div></div>
    );
  }

  if (!printerIp) {
    return (
      <div {...stylex.props(s.page)}><div {...stylex.props(s.pageInner)}>
        <nav {...stylex.props(s.topbar)}><a {...stylex.props(s.brand)} href="/"><span {...stylex.props(s.brandMark)}>P</span><span {...stylex.props(s.brandText)}><strong {...stylex.props(s.brandName)}>HOME PRINT HUB</strong><small {...stylex.props(s.brandSub)}>Epson XP-2200 • Homelab Edition</small></span></a><span {...stylex.props(s.health, s.healthSetup)}><span {...stylex.props(s.healthDot, s.dotWarn)} />SETUP NEEDED</span></nav>
        <main {...stylex.props(s.shell)}>
          <section {...stylex.props(s.welcome)} aria-labelledby="setup-title">
            <div {...stylex.props(s.welcomeCopy)}>
              <div {...stylex.props(s.welcomeCopyInner)}>
                <span {...stylex.props(s.stepPill)}><Sparkles size={12} /> ONE-TIME SETUP</span>
                <h1 id="setup-title" style={{ fontFamily: `"Space Grotesk", sans-serif`, fontSize: "clamp(28px, 5vw, 40px)", fontWeight: 700, lineHeight: .95, margin: "14px 0 0", letterSpacing: "-.03em" }}>CONNECT YOUR<br /><span style={{ background: vars.yellow, padding: "2px 10px", border: "3px solid #111", borderRadius: 8, boxShadow: `3px 3px 0 #111`, display: "inline-block", transform: "rotate(-1deg)" }}>PRINTER</span></h1>
                <p style={{ fontFamily: `"Space Grotesk", sans-serif`, fontSize: 14, fontWeight: 500, margin: "14px 0 0", lineHeight: 1.4 }}>Enter the IP on your router or the printer's network sheet. After this, everyone at home prints from here — no Epson suite.</p>
              </div>
            </div>
            <form onSubmit={handleSetup} {...stylex.props(s.cardPad)} style={{ display: "grid", gap: 14, background: "white" }}>
              <label {...stylex.props(s.fieldLabel)} htmlFor="printer-ip">PRINTER IP ADDRESS</label>
              <div {...stylex.props(s.fieldAction)}>
                <input id="printer-ip" {...stylex.props(s.input)} style={{ marginTop: 0 }} placeholder="192.168.1.50" inputMode="decimal" autoComplete="off" required value={setupIp} onChange={e => setSetupIp(e.target.value)} />
                <button type="submit" disabled={setupBusy} {...stylex.props(s.buttonPrimary)} style={{ width: "auto", minWidth: 140, marginTop: 0 }}>
                  {setupBusy ? <><Loader2 size={16} className="spin" /> CONNECTING…</> : <><Zap size={16} /> CONNECT</>}
                </button>
              </div>
              {setupBusy ? <div><div {...stylex.props(s.progress)}><span {...stylex.props(s.progressBar)} /></div><div {...stylex.props(s.opCopy)}><strong {...stylex.props(s.opCopyStrong)}>{setupStages[setupStage]}</strong><span>…</span></div></div> : null}
              <small style={{ fontFamily: `"Fragment Mono", monospace`, fontSize: 11, opacity: .6 }}>Tip: reserve this IP in your router so it never moves ✦</small>
            </form>
          </section>
          <div {...stylex.props(s.footer)}>PRIVATE HOME SERVICE • KEEP ON LOCAL NETWORK • MADE FOR HOMELAB ✦</div>
        </main>
      </div><style>{`@keyframes indeterminate{from{transform:translateX(-110%)}to{transform:translateX(305%)}} .spin{animation:spin 1s linear infinite} @keyframes spin{to{transform:rotate(360deg)}}`}</style></div>
    );
  }

  return (
    <div {...stylex.props(s.page)}><div {...stylex.props(s.pageInner)}>
      <nav {...stylex.props(s.topbar)}>
        <a {...stylex.props(s.brand)} href="/"><span {...stylex.props(s.brandMark)}>P</span><span {...stylex.props(s.brandText)}><strong {...stylex.props(s.brandName)}>HOME PRINT HUB</strong><small {...stylex.props(s.brandSub)}>Epson XP-2200 • Homelab Edition</small></span></a>
        <HealthBadge reachable={reachable} printerIp={printerIp} />
      </nav>

      <main {...stylex.props(s.shell)}>
        <header {...stylex.props(s.intro)}>
          <div>
            <div {...stylex.props(s.kicker)}><Sparkles size={12} /> READY WHEN YOU ARE</div>
            <h1 {...stylex.props(s.h1)}>WHAT DO YOU<br />WANNA DO?</h1>
            <p {...stylex.props(s.sub)}>Print a file or scan a doc — no drivers on this device. Everything stays on your LAN. <span style={{ background: vars.lime, padding: "2px 6px", border: "2px solid #111", borderRadius: 6, fontWeight: 700, fontFamily: `"Fragment Mono", monospace`, fontSize: 11 }}>FAST • PRIVATE • NO CLOUD</span></p>
          </div>
          <div {...stylex.props(s.chips)}>
            <span {...stylex.props(s.chip)} style={{ background: printer.ok ? vars.lime : vars.pink, color: printer.ok ? vars.text : "white" }}><Dot ok={!!printer.ok} /> PRINTER — {printer.state.replace("_", " ").toUpperCase()}</span>
            <span {...stylex.props(s.chip)} style={{ background: scanner.ok ? vars.teal : vars.yellow, color: scanner.ok ? "white" : vars.text }}><Dot ok={!!scanner.ok} warn={!scanner.ok} /> SCANNER — {scanner.ok ? "READY" : " NAPTIME"}</span>
          </div>
        </header>

        <section {...stylex.props(s.grid2)} aria-label="Print and scan">
          <article {...stylex.props(s.card, s.cardPad)} style={{ transform: "rotate(-0.4deg)" }}>
            <div {...stylex.props(s.taskHead)}>
              <span {...stylex.props(s.taskIcon, s.taskIconPrint)}><Printer size={20} strokeWidth={2.5} /></span>
              <div><p {...stylex.props(s.cardKicker)}>PRINT</p><h2 {...stylex.props(s.cardTitle)}>PUT A FILE<br />ON PAPER</h2></div>
              <span {...stylex.props(s.sticker)}><Sticker size={12} /> POP!</span>
            </div>
            <form onSubmit={handlePrint}>
              <label {...stylex.props(s.filePicker, dragOver ? s.filePickerActive : undefined)} onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }} htmlFor="print-file">
                <input ref={fileRef} id="print-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt" required={!file} {...stylex.props(s.filePickerInput)} onChange={e => onFile(e.target.files?.[0] || null)} />
                <span {...stylex.props(s.fileGlyph)}><Upload size={18} strokeWidth={2.5} /></span>
                <span><strong {...stylex.props(s.fileStrong)}>{file ? "✦ " + file.name : "CHOOSE A FILE"}</strong><small {...stylex.props(s.fileSmall)}>PDF • PNG • JPG • TXT • up to 128 MB • or drop it like it’s hot</small></span>
              </label>
              {file ? <div {...stylex.props(s.selectedFile)}><span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}><FileText size={14} strokeWidth={2.5} /><span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{file.name}</span><span style={{ opacity: .6 }}>· {(file.size / 1024).toFixed(0)} KB</span></span><button type="button" {...stylex.props(s.buttonQuiet)} style={{ padding: "6px 8px" }} onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }}><X size={14} /></button></div> : null}
              {printError ? <div {...stylex.props(s.error)}><X size={14} /> {printError}</div> : null}
              <div {...stylex.props(s.optionsRow)}>
                <label {...stylex.props(s.fieldLabel)} htmlFor="copies">COPIES <input id="copies" {...stylex.props(s.input, s.inputCompact)} type="number" min={1} max={99} value={copies} onChange={e => setCopies(Math.min(99, Math.max(1, Number(e.target.value) || 1)))} /></label>
                <label {...stylex.props(s.check)} htmlFor="grayscale"><input id="grayscale" type="checkbox" checked={grayscale} onChange={e => setGrayscale(e.target.checked)} style={{ width: 18, height: 18, accentColor: vars.text as string }} /> B&W ONLY</label>
              </div>
              <button type="submit" disabled={printBusy} {...stylex.props(s.buttonPrimary, s.buttonBlue)} style={{ marginTop: 16, backgroundColor: vars.blue, color: "white" }}>
                {printBusy ? <><Loader2 size={18} className="spin" /> SENDING…</> : <><Zap size={18} /> PRINT IT!</>}
              </button>
              {printBusy ? <div style={{ marginTop: 12 }}><div {...stylex.props(s.progress)}><span {...stylex.props(s.progressBar)} /></div><div {...stylex.props(s.opCopy)}><strong {...stylex.props(s.opCopyStrong)}>{printStages[printStage]}</strong><span>WORKING…</span></div></div> : null}
            </form>
          </article>

          <article {...stylex.props(s.card, s.cardPad)} style={{ transform: "rotate(0.4deg)" }}>
            <div {...stylex.props(s.taskHead)}>
              <span {...stylex.props(s.taskIcon, s.taskIconScan)}><ScanLine size={20} strokeWidth={2.5} /></span>
              <div><p {...stylex.props(s.cardKicker, s.cardKickerTeal)}>SCAN</p><h2 {...stylex.props(s.cardTitle)}>MAKE A<br />DIGITAL COPY</h2></div>
              <span {...stylex.props(s.sticker)} style={{ background: vars.yellow, color: vars.text }}>✦ SCAN!</span>
            </div>
            {scanner.ok ? (
              <form onSubmit={handleScan}>
                <div {...stylex.props(s.scanOptions)}>
                  <label {...stylex.props(s.fieldLabel)}>COLOUR <select {...stylex.props(s.input)} value={scanMode} onChange={e => setScanMode(e.target.value)}><option>Color</option><option>Gray</option><option>Lineart</option></select></label>
                  <label {...stylex.props(s.fieldLabel)}>QUALITY <select {...stylex.props(s.input)} value={scanDpi} onChange={e => setScanDpi(e.target.value)}><option value="150">Quick 150</option><option value="200">Standard 200</option><option value="300">High 300</option><option value="600">Beast 600</option></select></label>
                  <label {...stylex.props(s.fieldLabel)}>SAVE AS <select {...stylex.props(s.input)} value={scanFmt} onChange={e => setScanFmt(e.target.value)}><option value="pdf">PDF</option><option value="png">PNG</option><option value="jpg">JPG</option></select></label>
                </div>
                <p {...stylex.props(s.helpText)}>Face-down on the glass, hit scan. File pops below as download — done.</p>
                <button type="submit" disabled={scanBusy} {...stylex.props(s.buttonPrimary, s.buttonTeal)} style={{ backgroundColor: vars.teal }}>
                  {scanBusy ? <><Loader2 size={18} className="spin" /> SCANNING… like 60s</> : <><Scan size={18} /> SCAN IT!</>}
                </button>
                {scanBusy ? <div style={{ marginTop: 12 }}><div {...stylex.props(s.progress)}><span {...stylex.props(s.progressBar, s.progressBarTeal)} /></div><div {...stylex.props(s.opCopy)}><strong {...stylex.props(s.opCopyStrong)}>{scanStages[scanStage]}</strong><span>…</span></div></div> : null}
              </form>
            ) : (
              <div {...stylex.props(s.emptyScan)}>
                <strong style={{ fontFamily: `"Space Grotesk", sans-serif`, fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}><Loader2 size={18} className="spin" /> SCANNER NAPPING</strong>
                <p style={{ margin: "8px 0 0", fontFamily: `"Fragment Mono", monospace`, fontSize: 11, lineHeight: 1.5, fontWeight: 700 }}>Wakes up automatically. Check back in a minute — or smash scan anyway, we’ll validate.</p>
                <form onSubmit={handleScan} style={{ marginTop: 14, opacity: .9 }}>
                  <div {...stylex.props(s.scanOptions)}>
                    <label {...stylex.props(s.fieldLabel)}>COLOUR <select {...stylex.props(s.input)} value={scanMode} onChange={e => setScanMode(e.target.value)}><option>Color</option><option>Gray</option><option>Lineart</option></select></label>
                    <label {...stylex.props(s.fieldLabel)}>QUALITY <select {...stylex.props(s.input)} value={scanDpi} onChange={e => setScanDpi(e.target.value)}><option value="150">Quick</option><option value="200">Standard</option><option value="300">High</option><option value="600">Beast</option></select></label>
                    <label {...stylex.props(s.fieldLabel)}>SAVE AS <select {...stylex.props(s.input)} value={scanFmt} onChange={e => setScanFmt(e.target.value)}><option value="pdf">PDF</option><option value="png">PNG</option><option value="jpg">JPG</option></select></label>
                  </div>
                  <button type="submit" disabled={scanBusy} {...stylex.props(s.buttonPrimary, s.buttonTeal)} style={{ marginTop: 10, backgroundColor: vars.teal }}>{scanBusy ? "SCANNING…" : "TRY ANYWAY →"}</button>
                </form>
              </div>
            )}
          </article>
        </section>

        <section {...stylex.props(s.statusStrip)}>
          <div {...stylex.props(s.deviceCell)}><Dot ok={!!printer.ok} /><span><small {...stylex.props(s.deviceLabelSmall)}>PRINTER</small><strong {...stylex.props(s.deviceLabelStrong)}>{printer.state.replace("_", " ").toUpperCase()}</strong></span><span {...stylex.props(s.deviceDetail)}>{displayName} • {printerIp}</span></div>
          <div {...stylex.props(s.deviceCell)}><Dot ok={!!scanner.ok} warn={!scanner.ok} /><span><small {...stylex.props(s.deviceLabelSmall)}>SCANNER</small><strong {...stylex.props(s.deviceLabelStrong)}>{scanner.ok ? "READY" : "STARTING"}</strong></span><span {...stylex.props(s.deviceDetail)}>{scanner.ok ? (scanner.backend || "Ready") : "Warming up…"}</span></div>
          <div {...stylex.props(s.deviceCell)} style={{ borderRightWidth: 0, borderBottomWidth: 0 }}><Dot ok={queue.length === 0} warn={queue.length > 0} /><span><small {...stylex.props(s.deviceLabelSmall)}>QUEUE</small><strong {...stylex.props(s.deviceLabelStrong)}>{queue.length} {queue.length === 1 ? "JOB" : "JOBS"}</strong></span><span {...stylex.props(s.deviceDetail)}>{queue.length ? "BRRR… printing" : "Chillin’"}</span></div>
        </section>

        <div {...stylex.props(s.live)}><span {...stylex.props(s.liveDot, historyQ.isError ? s.liveDotError : undefined)} /><span>{historyQ.isError ? "RETRYING…" : "LIVE"}</span><span style={{ opacity: .5, fontWeight: 400 }}>• {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span><button {...stylex.props(s.buttonQuiet)} style={{ marginLeft: "auto", background: "white" }} onClick={() => { qc.invalidateQueries({ queryKey: ["status"] }); qc.invalidateQueries({ queryKey: ["history"] }); }}><RefreshCw size={12} /> REFRESH</button></div>

        <section {...stylex.props(s.activityGrid)}>
          <article {...stylex.props(s.card, s.cardPad)} hidden={queue.length === 0} style={{ display: queue.length === 0 ? "none" : undefined, transform: "rotate(-0.3deg)" }}>
            <div {...stylex.props(s.compactHead)}><div><span {...stylex.props(s.sectionKicker)}>IN PROGRESS</span><h2 style={{ margin: "8px 0 0", fontFamily: `"Space Grotesk", sans-serif`, fontSize: 18, fontWeight: 700 }}>PRINT QUEUE ✦</h2></div><span style={{ fontFamily: `"Fragment Mono", monospace`, fontSize: 11, fontWeight: 700, background: vars.text, color: "white", padding: "4px 10px", borderRadius: 999, border: "2px solid #111" }}>{queue.length}</span></div>
            <div {...stylex.props(s.itemList)}>{queue.map(j => <div key={j.id} {...stylex.props(s.itemRow)}><span style={{ minWidth: 0 }}><strong style={{ fontFamily: `"Space Grotesk", sans-serif`, fontSize: 13, display: "block" }}>{j.id}</strong><small style={{ fontFamily: `"Fragment Mono", monospace`, fontSize: 11, opacity: .6 }}>{j.owner} • {j.size}</small></span><button {...stylex.props(s.buttonQuiet, s.buttonDanger)} onClick={() => handleCancel(j.id)}><Trash2 size={12} /> CANCEL</button></div>)}</div>
          </article>
          <article {...stylex.props(s.card, s.cardPad)} hidden={scans.length === 0} style={{ display: scans.length === 0 ? "none" : undefined, transform: "rotate(0.3deg)" }}>
            <div {...stylex.props(s.compactHead)}><div><span {...stylex.props(s.sectionKicker)} style={{ background: vars.pink }}>DOWNLOADS</span><h2 style={{ margin: "8px 0 0", fontFamily: `"Space Grotesk", sans-serif`, fontSize: 18, fontWeight: 700 }}>RECENT SCANS ✦</h2></div></div>
            <div {...stylex.props(s.itemList)}>{scans.map(name => <a key={name} href={`/scans/${encodeURIComponent(name)}`} {...stylex.props(s.itemRow)}><span style={{ minWidth: 0 }}><strong style={{ fontFamily: `"Space Grotesk", sans-serif`, fontSize: 13 }}>{name}</strong><small style={{ fontFamily: `"Fragment Mono", monospace`, fontSize: 11, opacity: .6 }}>Saved scan</small></span><span {...stylex.props(s.downloadLink)}>DOWNLOAD ↗</span></a>)}</div>
          </article>
        </section>

        <details {...stylex.props(s.fold)} open={networkSharing}>
          <summary {...stylex.props(s.foldSummary)}><span><strong {...stylex.props(s.foldTitle)}>CONNECT PHONES + COMPUTERS ✦</strong><small {...stylex.props(s.foldSub)}>Share this printer around the house</small></span><span {...stylex.props(s.foldBadge, networkSharing ? s.foldBadgeOn : s.foldBadgeOff)}>{networkSharing ? <><Wifi size={12} /> SHARING ON</> : <><WifiOff size={12} /> OFF</>}</span><ChevronDown size={18} strokeWidth={2.5} /></summary>
          <div {...stylex.props(s.foldContent)}>
            <div {...stylex.props(s.networkGrid)}>
              <form onSubmit={handleNetworkSave} {...stylex.props(s.stack)}>
                <label {...stylex.props(s.fieldLabel)} htmlFor="display-name">PRINTER NAME <input id="display-name" {...stylex.props(s.input)} value={displayNameEdit} onChange={e => setDisplayNameEdit(e.target.value)} maxLength={80} required /></label>
                <label {...stylex.props(s.fieldLabel)} htmlFor="queue-name">TECH QUEUE NAME <input id="queue-name" {...stylex.props(s.input)} value={queueNameEdit} onChange={e => setQueueNameEdit(e.target.value)} pattern="[A-Za-z0-9._-]+" maxLength={127} required /></label>
                <label {...stylex.props(s.toggle)} htmlFor="share-toggle"><input id="share-toggle" type="checkbox" checked={shareEdit} onChange={e => setShareEdit(e.target.checked)} style={{ width: 20, height: 20, accentColor: "#111" }} /><span><strong style={{ display: "block", fontFamily: `"Space Grotesk", sans-serif`, fontSize: 13 }}>SHARE ON HOME NETWORK</strong><small style={{ display: "block", opacity: .6, fontFamily: `"Fragment Mono", monospace`, fontSize: 11 }}>AirPrint + Windows + Linux via Bonjour/mDNS</small></span></label>
                <button type="submit" disabled={netBusy} {...stylex.props(s.buttonPrimary)} style={{ justifySelf: "start", width: "auto", padding: "12px 20px", backgroundColor: vars.yellow }}>{netBusy ? <><Loader2 size={14} className="spin" /> SAVING…</> : "SAVE SHARING →"}</button>
                {netBusy ? <div><div {...stylex.props(s.progress)}><span {...stylex.props(s.progressBar)} /></div><div {...stylex.props(s.opCopy)}><strong {...stylex.props(s.opCopyStrong)}>{netStages[netStage]}</strong></div></div> : null}
              </form>
              <div>
                {networkSharing ? <>
                  <h3 style={{ margin: "0 0 6px", fontFamily: `"Space Grotesk", sans-serif`, fontSize: 14, fontWeight: 700 }}>AUTOMATIC SETUP ✦</h3><p style={{ margin: "0 0 14px", fontFamily: `"Fragment Mono", monospace`, fontSize: 12, opacity: .7 }}>On most devices, add a printer and choose <strong style={{ background: vars.yellow, padding: "2px 6px", border: "2px solid #111", borderRadius: 6 }}>{displayName}</strong> from the list.</p>
                  <h3 style={{ margin: "0 0 6px", fontFamily: `"Space Grotesk", sans-serif`, fontSize: 14, fontWeight: 700 }}>MANUAL ADDRESS</h3><div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><code {...stylex.props(s.codeBox)}>{ippUri}</code><button type="button" {...stylex.props(s.buttonQuiet)} onClick={() => copy(ippUri, "Manual URI copied")}><Copy size={12} /> COPY</button></div>
                  <details style={{ marginTop: 16, border: "2px dashed #111", borderRadius: 12, padding: 12, background: "white" }}><summary style={{ fontFamily: `"Fragment Mono", monospace`, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>WINDOWS + MAC STEPS →</summary><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 } as any}><div><h4 style={{ margin: "0 0 4px", fontFamily: `"Space Grotesk", sans-serif`, fontSize: 12 }}>Windows</h4><p style={{ margin: 0, fontFamily: `"Fragment Mono", monospace`, fontSize: 11, lineHeight: 1.5 }}>Settings → Bluetooth & devices → Printers → Add device. Manual: <code>{httpUri}</code></p></div><div><h4 style={{ margin: "0 0 4px", fontFamily: `"Space Grotesk", sans-serif`, fontSize: 12 }}>Mac</h4><p style={{ margin: 0, fontFamily: `"Fragment Mono", monospace`, fontSize: 11, lineHeight: 1.5 }}>System Settings → Printers & Scanners → Add Printer → <strong>{displayName}</strong></p></div></div></details>
                </> : <><h3 style={{ fontFamily: `"Space Grotesk", sans-serif`, fontSize: 14 }}>SHARING IS OFF</h3><p style={{ fontFamily: `"Fragment Mono", monospace`, fontSize: 12, opacity: .7 }}>Turn it on to let other devices find this printer over IPP.</p></>}
              </div>
            </div>
          </div>
        </details>

        <details {...stylex.props(s.fold)} open>
          <summary {...stylex.props(s.foldSummary)}><span><strong {...stylex.props(s.foldTitle)} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><History size={16} strokeWidth={2.5} /> PRINT HISTORY ✦</strong><small {...stylex.props(s.foldSub)}>{history.length} recent {history.length === 1 ? "job" : "jobs"} · file contents not stored</small></span><span style={{ fontFamily: `"Fragment Mono", monospace`, fontSize: 11, fontWeight: 700, background: vars.yellow, padding: "4px 10px", border: "2.5px solid #111", borderRadius: 999, boxShadow: `2px 2px 0 #111` }}>{history.length}</span><ChevronDown size={18} strokeWidth={2.5} /></summary>
          <div {...stylex.props(s.foldContent)} style={{ padding: 0 }}>
            <div style={{ padding: "14px 16px", display: "flex", gap: 10, alignItems: "center", borderBottom: `3px solid #111`, background: "white" }}>
              <div style={{ position: "relative", flex: 1 }}><Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} /><input {...stylex.props(s.input)} placeholder="SEARCH DOCS, USERS, STATUS…" value={historyFilter} onChange={e => setHistoryFilter(e.target.value)} style={{ marginTop: 0, paddingLeft: 36, minHeight: 40, fontFamily: `"Fragment Mono", monospace`, textTransform: "uppercase", fontSize: 11 }} /></div>
              {history.length > 30 ? <button {...stylex.props(s.buttonQuiet)} onClick={() => setShowAllHistory(v => !v)}>{showAllHistory ? "SHOW LESS" : `SHOW ALL (${filteredHistory.length})`}</button> : null}
            </div>
            {visibleHistory.length ? <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}><thead><tr style={{ background: vars.text, color: "white", fontFamily: `"Fragment Mono", monospace`, fontSize: 9, letterSpacing: ".08em", textTransform: "uppercase" }}><th style={{ padding: "10px 14px", textAlign: "left" }}>Document</th><th style={{ padding: "10px 14px", textAlign: "left" }}>When</th><th style={{ padding: "10px 14px", textAlign: "left" }}>From</th><th style={{ padding: "10px 14px", textAlign: "left" }}>Status</th><th style={{ padding: "10px 14px", textAlign: "left" }}>Size</th></tr></thead><tbody>{visibleHistory.map(j => <tr key={`${j.job_id}-${j.created_at}`} style={{ borderBottom: "2px solid #111", background: "white" }}><td style={{ padding: "12px 14px" }}><strong style={{ fontFamily: `"Space Grotesk", sans-serif`, fontSize: 13, display: "block" }}>{j.document}</strong><small style={{ fontFamily: `"Fragment Mono", monospace`, fontSize: 10, opacity: .6 }}>#{j.job_id}</small></td><td style={{ padding: "12px 14px", fontFamily: `"Fragment Mono", monospace`, fontSize: 11, whiteSpace: "nowrap" }}>{j.created_display}</td><td style={{ padding: "12px 14px", fontFamily: `"Fragment Mono", monospace`, fontSize: 11, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }}>{j.origin_host || j.user_name || j.source}</td><td style={{ padding: "12px 14px" }}><span style={{ display: "inline-block", padding: "4px 8px", borderRadius: 999, fontFamily: `"Fragment Mono", monospace`, fontSize: 10, fontWeight: 700, border: "2px solid #111", background: j.state === "completed" ? vars.lime : j.state === "pending" || j.state === "printing" ? vars.yellow : j.state === "cancelled" || j.state === "aborted" ? vars.pink : j.state === "held" ? vars.warnSoft : "white", color: vars.text }}>{j.state.replace("_", " ").toUpperCase()}</span></td><td style={{ padding: "12px 14px", fontFamily: `"Fragment Mono", monospace`, fontSize: 11, whiteSpace: "nowrap" }}>{j.size_display}</td></tr>)}</tbody></table></div> : <p style={{ margin: 0, padding: "20px 16px", fontFamily: `"Fragment Mono", monospace`, fontSize: 12, opacity: .6, textAlign: "center" }}>{historyFilter ? `NO JOBS MATCH “${historyFilter.toUpperCase()}”.` : "NO PRINT HISTORY YET — JOBS FROM PHONES + LAPTOPS WILL POP HERE ✦"}</p>}
          </div>
        </details>

        <details {...stylex.props(s.fold)}>
          <summary {...stylex.props(s.foldSummary)}><span><strong {...stylex.props(s.foldTitle)} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Settings2 size={16} strokeWidth={2.5} /> PRINTER SETTINGS ✦</strong><small {...stylex.props(s.foldSub)}>Change the printer address</small></span><ChevronDown size={18} strokeWidth={2.5} /></summary>
          <div {...stylex.props(s.foldContent)}><form onSubmit={handleChangeIp} style={{ maxWidth: 520, display: "grid", gap: 14 }}><label {...stylex.props(s.fieldLabel)} htmlFor="change-ip">PRINTER IP ADDRESS <input id="change-ip" {...stylex.props(s.input)} value={changeIp} onChange={e => setChangeIp(e.target.value)} placeholder="192.168.1.50" inputMode="decimal" required /></label><button type="submit" disabled={setupBusy} {...stylex.props(s.buttonPrimary)} style={{ width: "auto", justifySelf: "start", padding: "12px 20px", backgroundColor: vars.yellow }}>{setupBusy ? <><Loader2 size={14} className="spin" /> SAVING…</> : "SAVE ADDRESS →"}</button>{setupBusy ? <div><div {...stylex.props(s.progress)}><span {...stylex.props(s.progressBar)} /></div><div {...stylex.props(s.opCopy)}><strong {...stylex.props(s.opCopyStrong)}>{setupStages[setupStage]}</strong></div></div> : null}</form></div>
        </details>

        <div {...stylex.props(s.footer)}>PRIVATE HOME SERVICE • KEEP ON LOCAL NETWORK • PLAYFUL RETRO EDITION ✦ NOT AI SLOP</div>
      </main>
    </div>
    <style>{`@keyframes indeterminate{from{transform:translateX(-110%)}to{transform:translateX(305%)}} .spin{animation:spin 1s linear infinite} @keyframes spin{to{transform:rotate(360deg)}} details[open] > summary svg:last-child{transform:rotate(180deg)} summary svg:last-child{transition:transform .15s}`}</style>
    </div>
  );
}
