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
} from "lucide-react";

// ───────────────────────────────── styles ───────────────────────────────
const s = stylex.create({
  page: {
    backgroundColor: vars.bg,
    color: vars.text,
    minHeight: "100vh",
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    lineHeight: 1.5,
    WebkitFontSmoothing: "antialiased",
  },
  topbar: {
    position: "sticky",
    top: 0,
    zIndex: 10,
    height: "64px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    paddingLeft: "max(16px, calc((100vw - 1160px)/2))",
    paddingRight: "max(16px, calc((100vw - 1160px)/2))",
    backgroundColor: "rgba(255,255,255,.86)",
    backdropFilter: "blur(16px)",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: vars.line,
  },
  brand: {
    display: "inline-flex",
    alignItems: "center",
    gap: "12px",
    textDecoration: "none",
    color: vars.text,
  },
  brandMark: {
    width: "38px",
    height: "38px",
    borderRadius: "12px",
    display: "grid",
    placeItems: "center",
    backgroundImage: "linear-gradient(145deg, #2563eb, #3b82f6)",
    color: "white",
    fontWeight: 800,
    fontSize: "16px",
    boxShadow: "0 8px 20px rgba(37,99,235,.25)",
  },
  brandText: { display: "flex", flexDirection: "column", lineHeight: 1.1 },
  brandName: { fontSize: "14px", fontWeight: 800, letterSpacing: "-.02em" },
  brandSub: { fontSize: "11px", color: vars.textMuted, fontWeight: 600, marginTop: "2px" },
  health: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "7px 12px",
    borderRadius: vars.radiusFull,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.line,
    backgroundColor: vars.panelSoft,
    fontSize: "12px",
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  healthOnline: { color: vars.good, borderColor: "#a7f3d0", backgroundColor: vars.goodSoft },
  healthOffline: { color: vars.bad, borderColor: "#fecaca", backgroundColor: vars.badSoft },
  healthSetup: { color: vars.warn, borderColor: "#fde68a", backgroundColor: vars.warnSoft },
  healthDot: { width: "8px", height: "8px", borderRadius: vars.radiusFull, backgroundColor: "#94a3b8" },
  dotOnline: { backgroundColor: vars.good, boxShadow: "0 0 0 4px rgba(5,150,105,.12)" },
  dotOffline: { backgroundColor: vars.bad, boxShadow: "0 0 0 4px rgba(220,38,38,.12)" },
  dotWarn: { backgroundColor: vars.warn, boxShadow: "0 0 0 4px rgba(217,119,6,.12)" },

  shell: {
    width: "min(1160px, calc(100% - 32px))",
    marginLeft: "auto",
    marginRight: "auto",
    paddingTop: "36px",
    paddingBottom: "40px",
    "@media (max-width: 640px)": { width: "min(1160px, calc(100% - 20px))", paddingTop: "22px" },
  },
  // intro
  intro: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: "20px",
    marginBottom: "22px",
    "@media (max-width: 820px)": { flexDirection: "column", alignItems: "flex-start" },
  },
  kicker: { margin: 0, color: vars.blue, fontSize: "11px", fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase" },
  h1: { margin: "4px 0 0", fontSize: "clamp(28px, 4vw, 40px)", lineHeight: 1.05, letterSpacing: "-.035em", fontWeight: 800 },
  sub: { margin: "10px 0 0", color: vars.textMuted, fontSize: "15px", maxWidth: "560px", lineHeight: 1.5, "@media (max-width:640px)": { fontSize: "14px" } },
  chips: { display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end", "@media (max-width:820px)": { justifyContent: "flex-start" } },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "7px",
    padding: "8px 12px",
    borderRadius: vars.radiusFull,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.line,
    backgroundColor: "rgba(255,255,255,.8)",
    fontSize: "12px",
    fontWeight: 600,
    color: vars.textMuted,
  },
  chipDot: { width: "8px", height: "8px", borderRadius: vars.radiusFull, backgroundColor: "#cbd5e1" },

  grid2: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "18px",
    "@media (max-width: 860px)": { gridTemplateColumns: "1fr" },
  },
  card: {
    backgroundColor: vars.panel,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.line,
    borderRadius: vars.radiusXl,
    boxShadow: vars.shadowMd,
    overflow: "hidden",
  },
  cardPad: { padding: "22px", "@media (max-width:640px)": { padding: "18px" } },
  taskHead: { display: "flex", gap: "12px", alignItems: "center", marginBottom: "18px" },
  taskIcon: {
    width: "42px",
    height: "42px",
    borderRadius: "12px",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  },
  taskIconPrint: { backgroundColor: vars.blueSoft, color: vars.blue },
  taskIconScan: { backgroundColor: vars.tealSoft, color: vars.teal },
  cardTitle: { margin: 0, fontSize: "18px", fontWeight: 800, letterSpacing: "-.02em" },
  cardKicker: { margin: 0, fontSize: "11px", fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: vars.blue },
  cardKickerTeal: { color: vars.teal },

  filePicker: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "14px",
    minHeight: "124px",
    padding: "18px",
    borderWidth: "1.5px",
    borderStyle: "dashed",
    borderColor: "#cbd5e1",
    borderRadius: vars.radiusLg,
    backgroundColor: "#f8fbff",
    cursor: "pointer",
    transition: "border-color .15s, background .15s, transform .1s",
    textAlign: "left",
    ":hover": { borderColor: vars.blue, backgroundColor: "#f1f7ff" },
  },
  filePickerActive: { borderColor: vars.blue, backgroundColor: "#eef6ff", transform: "scale(1.005)" },
  filePickerInput: { position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" },
  fileGlyph: {
    width: "38px",
    height: "38px",
    borderRadius: "11px",
    display: "grid",
    placeItems: "center",
    backgroundColor: "white",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#dbeafe",
    color: vars.blue,
    boxShadow: vars.shadowSm,
    flexShrink: 0,
  },
  fileStrong: { display: "block", fontSize: "14px", fontWeight: 700, color: vars.text },
  fileSmall: { display: "block", fontSize: "12px", color: vars.textMuted, marginTop: "2px" },
  selectedFile: {
    marginTop: "10px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    padding: "10px 12px",
    borderRadius: vars.radiusMd,
    backgroundColor: vars.panelSoft,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.line,
    fontSize: "12px",
  },
  error: {
    marginTop: "10px",
    padding: "10px 12px",
    borderRadius: vars.radiusMd,
    backgroundColor: vars.badSoft,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#fecaca",
    color: "#991b1b",
    fontSize: "12px",
    fontWeight: 600,
    display: "flex",
    gap: "8px",
    alignItems: "center",
  },
  optionsRow: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-end",
    marginTop: "14px",
    "@media (max-width:560px)": { flexDirection: "column", alignItems: "stretch" },
  },
  fieldLabel: { display: "block", fontSize: "11px", fontWeight: 700, color: "#475569", flex: "0 0 auto" },
  input: {
    width: "100%",
    minHeight: "42px",
    marginTop: "6px",
    padding: "9px 12px",
    borderRadius: vars.radiusMd,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.lineStrong,
    backgroundColor: "white",
    color: vars.text,
    fontSize: "14px",
    outlineWidth: "0px",
    ":focus": { borderColor: vars.blue, boxShadow: "0 0 0 3px rgba(37,99,235,.15)" },
  },
  inputCompact: { width: "96px", "@media (max-width:560px)": { width: "100%" } },
  check: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "0 14px",
    minHeight: "42px",
    borderRadius: vars.radiusMd,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.lineStrong,
    backgroundColor: "white",
    fontSize: "13px",
    fontWeight: 600,
    color: vars.text,
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
  },
  buttonPrimary: {
    width: "100%",
    minHeight: "46px",
    borderWidth: 0,
    borderRadius: vars.radiusMd,
    backgroundColor: vars.blue,
    color: "white",
    fontWeight: 800,
    fontSize: "14px",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    transition: "background .15s, transform .06s, opacity .15s",
    ":hover": { backgroundColor: vars.blueDark },
    ":active": { transform: "translateY(1px)" },
    ":disabled": { opacity: .6, cursor: "wait" },
  },
  buttonTeal: { backgroundColor: vars.teal, ":hover": { backgroundColor: vars.tealDark } },
  buttonQuiet: {
    borderWidth: 0,
    borderRadius: vars.radiusSm,
    padding: "8px 12px",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
    backgroundColor: vars.blueSoft,
    color: vars.blue,
    transition: "background .15s, color .15s",
    ":hover": { backgroundColor: vars.blue, color: "white" },
  },
  buttonDanger: { backgroundColor: vars.badSoft, color: vars.bad, ":hover": { backgroundColor: vars.bad, color: "white" } },

  progress: { height: "3px", backgroundColor: "#e2e8f0", borderRadius: "999px", overflow: "hidden" },
  progressBar: {
    height: "100%",
    width: "34%",
    borderRadius: "inherit",
    backgroundColor: vars.blue,
    animationName: "indeterminate",
    animationDuration: "1.2s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  },
  progressBarTeal: { backgroundColor: vars.teal },
  opCopy: { display: "flex", justifyContent: "space-between", gap: "10px", marginTop: "8px", fontSize: "11px", color: vars.textMuted },
  opCopyStrong: { fontWeight: 700, color: "#475569" },
  scanOptions: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0,1fr))",
    gap: "10px",
    "@media (max-width:560px)": { gridTemplateColumns: "1fr 1fr" },
  },
  helpText: { margin: "12px 0", color: vars.textMuted, fontSize: "12px" },
  emptyScan: {
    minHeight: "220px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    padding: "18px",
    borderRadius: vars.radiusLg,
    backgroundColor: "#fffbeb",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#fde68a",
  },
  // status strip
  statusStrip: {
    marginTop: "18px",
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0,1fr))",
    overflow: "hidden",
    "@media (max-width:820px)": { gridTemplateColumns: "1fr" },
  },
  deviceCell: {
    display: "grid",
    gridTemplateColumns: "auto auto minmax(0,1fr)",
    alignItems: "center",
    gap: "10px",
    padding: "16px 18px",
    borderRightWidth: "1px",
    borderRightStyle: "solid",
    borderRightColor: vars.line,
    "@media (max-width:820px)": {
      borderRightWidth: 0,
      borderBottomWidth: "1px",
      borderBottomStyle: "solid",
      borderBottomColor: vars.line,
    },
  },
  deviceLabelSmall: { display: "block", fontSize: "10px", fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: vars.textMuted, lineHeight: 1.2 },
  deviceLabelStrong: { display: "block", fontSize: "13px", fontWeight: 800, textTransform: "capitalize", lineHeight: 1.2 },
  deviceDetail: { fontSize: "11px", color: vars.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" },
  live: { display: "flex", alignItems: "center", gap: "8px", marginTop: "10px", fontSize: "11px", fontWeight: 700, color: vars.textMuted },
  liveDot: { width: "7px", height: "7px", borderRadius: vars.radiusFull, backgroundColor: vars.good, boxShadow: "0 0 0 4px rgba(5,150,105,.14)" },
  liveDotError: { backgroundColor: vars.bad, boxShadow: "0 0 0 4px rgba(220,38,38,.12)" },
  activityGrid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: "18px", marginTop: "18px", "@media (max-width:860px)": { gridTemplateColumns: "1fr" } },
  compactHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "12px" },
  itemList: { borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: vars.line },
  itemRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "12px 0",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: vars.line,
    textDecoration: "none",
    color: vars.text,
  },
  downloadLink: { fontSize: "12px", fontWeight: 800, color: vars.blue },
  // folds
  fold: { marginTop: "14px", overflow: "hidden" },
  foldSummary: {
    minHeight: "64px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "14px",
    padding: "14px 18px",
    cursor: "pointer",
    listStyle: "none",
  },
  foldTitle: { fontSize: "14px", fontWeight: 800 },
  foldSub: { fontSize: "12px", color: vars.textMuted, marginTop: "2px" },
  foldBadge: {
    fontSize: "11px",
    fontWeight: 800,
    padding: "5px 10px",
    borderRadius: vars.radiusFull,
    backgroundColor: vars.badSoft,
    color: "#991b1b",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#fecaca",
  },
  foldBadgeOn: { backgroundColor: vars.goodSoft, color: "#065f46", borderColor: "#a7f3d0" },
  foldContent: { borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: vars.line, backgroundColor: vars.panelSoft, padding: "20px", "@media (max-width:640px)": { padding: "16px" } },
  networkGrid: { display: "grid", gridTemplateColumns: "minmax(0,.9fr) minmax(0,1.1fr)", gap: "28px", "@media (max-width:860px)": { gridTemplateColumns: "1fr" } },
  stack: { display: "grid", gap: "12px" },
  toggle: {
    display: "flex",
    gap: "10px",
    alignItems: "flex-start",
    padding: "12px",
    borderRadius: vars.radiusMd,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.line,
    backgroundColor: "white",
    cursor: "pointer",
  },
  codeBox: {
    flex: "1 1 auto",
    minWidth: 0,
    padding: "10px 12px",
    borderRadius: vars.radiusMd,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.line,
    backgroundColor: "white",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "12px",
    overflowX: "auto",
    whiteSpace: "nowrap",
  },
  jewel: { display: "inline-flex", alignItems: "center", gap: "6px", color: vars.textMuted },
  // welcome
  welcome: { maxWidth: "760px", marginLeft: "auto", marginRight: "auto", marginTop: "40px", overflow: "hidden" },
  welcomeCopy: { padding: "32px", backgroundImage: "linear-gradient(145deg, #eff6ff, #dbeafe)", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "#bfdbfe" },
  stepPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 10px",
    borderRadius: vars.radiusFull,
    backgroundColor: "white",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#bfdbfe",
    color: vars.blue,
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: ".06em",
    textTransform: "uppercase",
  },
  fieldAction: { display: "grid", gridTemplateColumns: "1fr auto", gap: "10px", "@media (max-width:560px)": { gridTemplateColumns: "1fr" } },
  skeleton: { backgroundColor: "#e2e8f0", borderRadius: "8px", animationName: "pulse", animationDuration: "1.4s", animationIterationCount: "infinite" },
  footer: { padding: "28px 16px 36px", textAlign: "center", color: "#94a3b8", fontSize: "11px" },
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
  if (!printerIp) return <span {...stylex.props(s.health, s.healthSetup)}><span {...stylex.props(s.healthDot, s.dotWarn)} />Setup needed</span>;
  if (reachable) return <span {...stylex.props(s.health, s.healthOnline)}><span {...stylex.props(s.healthDot, s.dotOnline)} />Online</span>;
  return <span {...stylex.props(s.health, s.healthOffline)}><span {...stylex.props(s.healthDot, s.dotOffline)} />Needs attention</span>;
}

function Dot({ ok, warn }: { ok?: boolean; warn?: boolean }) {
  return <span {...stylex.props(s.chipDot, ok ? s.dotOnline : warn ? s.dotWarn : s.dotOffline)} aria-hidden="true" />;
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

  // derive host for IPP
  const host = useMemo(() => {
    // if CLIENT_HOST not injected, use window location host
    const h = window.location.host;
    // strip port
    if (h.startsWith("[")) return h.split("]")[0] + "]";
    return h.split(":")[0] || "localhost";
  }, []);
  const ippUri = `ipp://${host}:631/printers/${printerName}`;
  const httpUri = `http://${host}:631/printers/${printerName}`;

  // local UI state
  const [setupIp, setSetupIp] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupStage, setSetupStage] = useState(0);
  const setupStages = ["Checking the printer address", "Configuring the print service", "Waiting for the printer to respond"];

  // print
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

  // scan
  const [scanMode, setScanMode] = useState("Color");
  const [scanDpi, setScanDpi] = useState("300");
  const [scanFmt, setScanFmt] = useState("pdf");
  const [scanBusy, setScanBusy] = useState(false);
  const [scanStage, setScanStage] = useState(0);
  const scanStages = ["Contacting the scanner", "Scanning the document", "Preparing the download"];
  const scanStageSeconds = 15;

  // network form
  const [displayNameEdit, setDisplayNameEdit] = useState(displayName);
  const [queueNameEdit, setQueueNameEdit] = useState(printerName);
  const [shareEdit, setShareEdit] = useState(networkSharing);
  const [netBusy, setNetBusy] = useState(false);
  const [netStage, setNetStage] = useState(0);
  const netStages = ["Validating the settings", "Updating the print queue", "Refreshing network sharing"];
  useEffect(() => { setDisplayNameEdit(displayName); setQueueNameEdit(printerName); setShareEdit(networkSharing); }, [displayName, printerName, networkSharing]);

  // history search
  const [historyFilter, setHistoryFilter] = useState("");
  const [showAllHistory, setShowAllHistory] = useState(false);
  const history = historyQ.data?.history || [];
  const filteredHistory = useMemo(() => {
    if (!historyFilter.trim()) return history;
    const q = historyFilter.toLowerCase();
    return history.filter(h => `${h.document} ${h.source} ${h.state} ${h.user_name || ""} ${h.origin_host || ""}`.toLowerCase().includes(q));
  }, [history, historyFilter]);
  const visibleHistory = showAllHistory ? filteredHistory : filteredHistory.slice(0, 30);

  // printer settings second ip
  const [changeIp, setChangeIp] = useState(printerIp);
  useEffect(() => setChangeIp(printerIp), [printerIp]);

  // busy timers
  useEffect(() => {
    if (!setupBusy) return;
    const id = setInterval(() => setSetupStage(s => Math.min(s + 1, setupStages.length - 1)), 8000);
    return () => clearInterval(id);
  }, [setupBusy]);
  useEffect(() => {
    if (!printBusy) return;
    const id = setInterval(() => setPrintStage(s => Math.min(s + 1, printStages.length - 1)), 9000);
    return () => clearInterval(id);
  }, [printBusy]);
  useEffect(() => {
    if (!scanBusy) return;
    const id = setInterval(() => setScanStage(s => Math.min(s + 1, scanStages.length - 1)), scanStageSeconds * 1000);
    return () => clearInterval(id);
  }, [scanBusy]);
  useEffect(() => {
    if (!netBusy) return;
    const id = setInterval(() => setNetStage(s => Math.min(s + 1, netStages.length - 1)), 7000);
    return () => clearInterval(id);
  }, [netBusy]);

  // handlers
  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    const ip = setupIp.trim();
    if (!ip) return;
    // simple ipv4 check
    const parts = ip.split(".");
    if (parts.length !== 4 || parts.some(p => !/^\d+$/.test(p) || Number(p) < 0 || Number(p) > 255)) {
      push({ kind: "error", title: "Use the printer's normal IPv4 address" });
      return;
    }
    setSetupBusy(true); setSetupStage(0);
    try {
      await ensureCsrf();
      const fd = new FormData(); fd.set("printer_ip", ip);
      // try json aware endpoint
      const csrf = await ensureCsrf();
      fd.set("_csrf_token", csrf);
      const res = await fetch("/setup", { method: "POST", body: fd, credentials: "same-origin", headers: { "X-CSRF-Token": csrf, Accept: "application/json" } });
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || j.message || "Setup failed");
        push({ kind: "success", title: `Printer saved at ${ip}`, desc: "CUPS is configured." });
      } else {
        // fallback html redirect – treat as success if not error flash in text
        const txt = await res.text();
        if (txt.toLowerCase().includes("error") && txt.toLowerCase().includes("cups")) {
          // try to extract flash
          const m = txt.match(/class="notice error"[\s\S]*?>([\s\S]*?)<\/div>/);
          throw new Error(m ? m[1].replace(/<[^>]+>/g, "").trim().slice(0, 180) : "CUPS setup failed");
        }
        push({ kind: "success", title: `Printer saved at ${ip}`, desc: "CUPS is configured." });
      }
      await qc.invalidateQueries({ queryKey: ["status"] });
      await qc.invalidateQueries({ queryKey: ["history"] });
    } catch (err: any) {
      push({ kind: "error", title: "Could not save printer", desc: String(err.message || err).slice(0, 220) });
    } finally { setSetupBusy(false); }
  };

  const handlePrint = async (e: React.FormEvent) => {
    e.preventDefault();
    setPrintError(null);
    if (!file) { setPrintError("Choose a file first."); return; }
    const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
    if (![".pdf", ".png", ".jpg", ".jpeg", ".txt"].includes(ext)) { setPrintError("Supported files: PDF, PNG, JPG and TXT."); return; }
    if (file.size === 0) { setPrintError("The selected file is empty."); return; }
    if (file.size > MAX_MB * 1024 * 1024) { setPrintError(`That file is too large. The limit is ${MAX_MB} MB.`); return; }
    if (copies < 1 || copies > 99) { setPrintError("Copies must be between 1 and 99."); return; }
    setPrintBusy(true); setPrintStage(0);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("copies", String(copies));
      if (grayscale) fd.set("grayscale", "on");
      await apiPostForm("/print", fd);
      push({ kind: "success", title: "File added to the print queue", desc: `${file.name} · ${copies} ${copies === 1 ? "copy" : "copies"}` });
      setFile(null); if (fileRef.current) fileRef.current.value = "";
      await qc.invalidateQueries({ queryKey: ["status"] });
      await qc.invalidateQueries({ queryKey: ["history"] });
    } catch (err: any) {
      const msg = String(err.message || err);
      setPrintError(msg.slice(0, 260));
      push({ kind: "error", title: "Print failed", desc: msg.slice(0, 200) });
    } finally { setPrintBusy(false); }
  };

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!["150", "200", "300", "600"].includes(scanDpi)) { push({ kind: "error", title: "DPI must be 150, 200, 300 or 600." }); return; }
    setScanBusy(true); setScanStage(0);
    try {
      const fd = new FormData();
      fd.set("dpi", scanDpi); fd.set("mode", scanMode); fd.set("format", scanFmt);
      await apiPostForm("/scan", fd);
      // success is via flash redirect; treat as ok, then poll scans
      push({ kind: "success", title: "Scan complete", desc: `Saved as ${scanFmt.toUpperCase()} · ${scanDpi} dpi` });
      await qc.invalidateQueries({ queryKey: ["status"] });
    } catch (err: any) {
      const msg = String(err.message || err);
      if (msg.toLowerCase().includes("already in progress")) {
        push({ kind: "error", title: "Scan already in progress", desc: "Wait for it to finish before starting another." });
      } else push({ kind: "error", title: "Scan failed", desc: msg.slice(0, 220) });
    } finally { setScanBusy(false); }
  };

  const handleNetworkSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayNameEdit.trim() || displayNameEdit.trim().length > 80) { push({ kind: "error", title: "Display name must be 1-80 characters" }); return; }
    if (!/^[A-Za-z0-9._-]{1,127}$/.test(queueNameEdit.trim())) { push({ kind: "error", title: "Queue name may only contain letters, numbers, dot, dash and underscore" }); return; }
    setNetBusy(true); setNetStage(0);
    try {
      const fd = new FormData();
      fd.set("display_name", displayNameEdit.trim());
      fd.set("printer_name", queueNameEdit.trim());
      if (shareEdit) fd.set("share_printer", "on");
      await apiPostForm("/client-settings", fd);
      push({ kind: "success", title: "Network sharing settings applied" });
      await qc.invalidateQueries({ queryKey: ["status"] });
    } catch (err: any) {
      push({ kind: "error", title: "Could not save sharing settings", desc: String(err.message || err).slice(0, 220) });
    } finally { setNetBusy(false); }
  };

  const handleChangeIp = async (e: React.FormEvent) => {
    e.preventDefault();
    const ip = changeIp.trim();
    if (!ip) return;
    setSetupBusy(true); setSetupStage(0);
    try {
      const fd = new FormData(); fd.set("printer_ip", ip);
      await apiPostForm("/setup", fd);
      push({ kind: "success", title: `Printer address updated`, desc: ip });
      await qc.invalidateQueries({ queryKey: ["status"] });
    } catch (err: any) {
      push({ kind: "error", title: "Could not update address", desc: String(err.message || err).slice(0, 220) });
    } finally { setSetupBusy(false); }
  };

  const handleCancel = async (jobId: string) => {
    try {
      const fd = new FormData();
      await apiPostForm(`/jobs/${encodeURIComponent(jobId)}/cancel`, fd);
      push({ kind: "success", title: "Job cancelled", desc: jobId });
      await qc.invalidateQueries({ queryKey: ["status"] });
      await qc.invalidateQueries({ queryKey: ["history"] });
    } catch (err: any) {
      push({ kind: "error", title: "Could not cancel job", desc: String(err.message || err).slice(0, 200) });
    }
  };

  // file helpers
  const onFile = (f: File | null) => {
    setPrintError(null);
    if (!f) { setFile(null); return; }
    const ext = "." + (f.name.split(".").pop() || "").toLowerCase();
    if (![".pdf", ".png", ".jpg", ".jpeg", ".txt"].includes(ext)) { setPrintError("Supported files: PDF, PNG, JPG and TXT."); setFile(null); return; }
    if (f.size > MAX_MB * 1024 * 1024) { setPrintError(`That file is too large. The limit is ${MAX_MB} MB.`); setFile(null); return; }
    if (f.size === 0) { setPrintError("The selected file is empty."); setFile(null); return; }
    setFile(f);
  };

  // live time ago for indicator
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNowTick(Date.now()), 1000); return () => clearInterval(id); }, []);
  const lastUpdated = (data as any)?._fetchedAt || nowTick; // placeholder

  if (isLoading) {
    return (
      <div {...stylex.props(s.page)}>
        <nav {...stylex.props(s.topbar)} aria-label="Home Print Hub">
          <a {...stylex.props(s.brand)} href="/">
            <span {...stylex.props(s.brandMark)}>P</span>
            <span {...stylex.props(s.brandText)}><strong {...stylex.props(s.brandName)}>Home Print Hub</strong><small {...stylex.props(s.brandSub)}>Epson XP-2200</small></span>
          </a>
          <span {...stylex.props(s.skeleton)} style={{ width: 110, height: 28, borderRadius: 999 }} />
        </nav>
        <main {...stylex.props(s.shell)}>
          <div {...stylex.props(s.skeleton)} style={{ height: 42, width: 280, marginBottom: 12 }} />
          <div {...stylex.props(s.skeleton)} style={{ height: 18, width: 520, maxWidth: "100%", marginBottom: 24 }} />
          <div {...stylex.props(s.grid2)}>
            <div {...stylex.props(s.card, s.cardPad)} style={{ minHeight: 340 }}><div {...stylex.props(s.skeleton)} style={{ height: "100%", minHeight: 300 }} /></div>
            <div {...stylex.props(s.card, s.cardPad)} style={{ minHeight: 340 }}><div {...stylex.props(s.skeleton)} style={{ height: "100%", minHeight: 300 }} /></div>
          </div>
        </main>
        <style>{`@keyframes pulse{0%,100%{opacity:.6}50%{opacity:.3}} @keyframes indeterminate{from{transform:translateX(-110%)}to{transform:translateX(305%)}}`}</style>
      </div>
    );
  }

  if (isError) {
    const msg = (error as any)?.message || "";
    const isAuth = msg.includes("401") || msg.toLowerCase().includes("authentication");
    return (
      <div {...stylex.props(s.page)}>
        <nav {...stylex.props(s.topbar)}>
          <a {...stylex.props(s.brand)} href="/"><span {...stylex.props(s.brandMark)}>P</span><span {...stylex.props(s.brandText)}><strong {...stylex.props(s.brandName)}>Home Print Hub</strong><small {...stylex.props(s.brandSub)}>Epson XP-2200</small></span></a>
          <span {...stylex.props(s.health, s.healthSetup)}><ShieldAlert size={14} /> Private</span>
        </nav>
        <main {...stylex.props(s.shell)}>
          <div {...stylex.props(s.card, s.cardPad)} style={{ maxWidth: 560, margin: "40px auto", textAlign: "center" }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, display: "grid", placeItems: "center", background: "#fef2f2", color: "#dc2626", margin: "0 auto 16px", border: "1px solid #fecaca" }}><ShieldAlert /></div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{isAuth ? "Authentication required" : "Could not reach Home Print Hub"}</h1>
            <p style={{ color: vars.textMuted as string, fontSize: 13, marginTop: 8 }}>{isAuth ? "This HomeLab service is protected. Check WEB_USERNAME / WEB_PASSWORD and sign in again." : msg || "The server is starting or the network is unavailable. Try refreshing."}</p>
            <button {...stylex.props(s.buttonPrimary)} style={{ marginTop: 16, width: "auto", padding: "10px 18px" }} onClick={() => refetch()}><RefreshCw size={16} /> Retry</button>
          </div>
        </main>
      </div>
    );
  }

  // setup required
  if (!printerIp) {
    return (
      <div {...stylex.props(s.page)}>
        <nav {...stylex.props(s.topbar)} aria-label="Home Print Hub">
          <a {...stylex.props(s.brand)} href="/"><span {...stylex.props(s.brandMark)}>P</span><span {...stylex.props(s.brandText)}><strong {...stylex.props(s.brandName)}>Home Print Hub</strong><small {...stylex.props(s.brandSub)}>Epson XP-2200</small></span></a>
          <span {...stylex.props(s.health, s.healthSetup)}><span {...stylex.props(s.healthDot, s.dotWarn)} />Setup needed</span>
        </nav>
        <main {...stylex.props(s.shell)}>
          <section {...stylex.props(s.card, s.welcome)} aria-labelledby="setup-title">
            <div {...stylex.props(s.welcomeCopy)}>
              <span {...stylex.props(s.stepPill)}><Settings2 size={12} /> One-time setup</span>
              <h1 id="setup-title" {...stylex.props(s.h1)} style={{ marginTop: 12, fontSize: "clamp(26px, 4vw, 36px)" }}>Connect your printer</h1>
              <p {...stylex.props(s.sub)}>Enter the IP shown in your router or on the printer's network status sheet. After this, everyone at home can print from this page — no Epson suite needed.</p>
            </div>
            <form onSubmit={handleSetup} {...stylex.props(s.cardPad)} style={{ display: "grid", gap: 12 }}>
              <label {...stylex.props(s.fieldLabel)} htmlFor="printer-ip">Printer IP address</label>
              <div {...stylex.props(s.fieldAction)}>
                <input id="printer-ip" {...stylex.props(s.input)} style={{ marginTop: 0 }} placeholder="192.168.1.50" inputMode="decimal" autoComplete="off" required value={setupIp} onChange={e => setSetupIp(e.target.value)} />
                <button type="submit" disabled={setupBusy} {...stylex.props(s.buttonPrimary)} style={{ width: "auto", minWidth: 132, marginTop: 0 }}>
                  {setupBusy ? <><Loader2 size={16} className="spin" /> Connecting…</> : "Connect"}
                </button>
              </div>
              {setupBusy ? (
                <div style={{ marginTop: 4 }}>
                  <div {...stylex.props(s.progress)}><span {...stylex.props(s.progressBar)} /></div>
                  <div {...stylex.props(s.opCopy)}><strong {...stylex.props(s.opCopyStrong)}>{setupStages[setupStage]}</strong><span>…</span></div>
                </div>
              ) : null}
              <small style={{ color: vars.textMuted as string, fontSize: 12 }}>Tip: reserve this address in your router so it doesn't change.</small>
            </form>
          </section>
          <div {...stylex.props(s.footer)}>Private home service · Keep this hub on your local network. Do not expose it to the internet.</div>
        </main>
        <style>{`@keyframes indeterminate{from{transform:translateX(-110%)}to{transform:translateX(305%)}} .spin{animation:spin 1s linear infinite} @keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  // main dashboard
  return (
    <div {...stylex.props(s.page)}>
      <nav {...stylex.props(s.topbar)} aria-label="Home Print Hub">
        <a {...stylex.props(s.brand)} href="/"><span {...stylex.props(s.brandMark)}>P</span><span {...stylex.props(s.brandText)}><strong {...stylex.props(s.brandName)}>Home Print Hub</strong><small {...stylex.props(s.brandSub)}>Epson XP-2200</small></span></a>
        <HealthBadge reachable={reachable} printerIp={printerIp} />
      </nav>

      <main {...stylex.props(s.shell)}>
        <header {...stylex.props(s.intro)}>
          <div>
            <p {...stylex.props(s.kicker)}>Ready when you are</p>
            <h1 {...stylex.props(s.h1)}>What would you like to do?</h1>
            <p {...stylex.props(s.sub)}>Print a file or scan a document without installing anything on this device. Everything stays on your LAN.</p>
          </div>
          <div {...stylex.props(s.chips)} aria-label="Service status">
            <span {...stylex.props(s.chip)}><Dot ok={!!printer.ok} /> Printer {printer.state.replace("_", " ")}</span>
            <span {...stylex.props(s.chip)}><Dot ok={!!scanner.ok} warn={!scanner.ok} /> Scanner {scanner.ok ? "ready" : "unavailable"}</span>
          </div>
        </header>

        <section {...stylex.props(s.grid2)} aria-label="Print and scan">
          {/* Print */}
          <article {...stylex.props(s.card, s.cardPad)}>
            <div {...stylex.props(s.taskHead)}>
              <span {...stylex.props(s.taskIcon, s.taskIconPrint)} aria-hidden="true"><Printer size={18} /></span>
              <div><p {...stylex.props(s.cardKicker)}>Print</p><h2 {...stylex.props(s.cardTitle)}>Put a file on paper</h2></div>
            </div>

            <form onSubmit={handlePrint}>
              <label
                {...stylex.props(s.filePicker, dragOver ? s.filePickerActive : undefined)}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
                htmlFor="print-file"
              >
                <input
                  ref={fileRef}
                  id="print-file"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.txt"
                  required={!file}
                  {...stylex.props(s.filePickerInput)}
                  onChange={e => onFile(e.target.files?.[0] || null)}
                />
                <span {...stylex.props(s.fileGlyph)}><Upload size={16} /></span>
                <span>
                  <strong {...stylex.props(s.fileStrong)}>{file ? file.name : "Choose a file"}</strong>
                  <small {...stylex.props(s.fileSmall)}>PDF, image or text · up to {MAX_MB} MB · or drag & drop here</small>
                </span>
              </label>

              {file ? (
                <div {...stylex.props(s.selectedFile)}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <FileText size={14} style={{ flexShrink: 0, color: vars.blue as string }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
                    <span style={{ color: vars.textFaint as string, whiteSpace: "nowrap" }}>· {(file.size / 1024).toFixed(0)} KB</span>
                  </span>
                  <button type="button" {...stylex.props(s.buttonQuiet, s.buttonDanger)} style={{ padding: "6px 8px" }} onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }} aria-label="Remove file"><X size={14} /></button>
                </div>
              ) : null}

              {printError ? <div {...stylex.props(s.error)} role="alert"><AlertCircle size={14} /> {printError}</div> : null}

              <div {...stylex.props(s.optionsRow)}>
                <label {...stylex.props(s.fieldLabel)} htmlFor="copies">Copies
                  <input id="copies" {...stylex.props(s.input, s.inputCompact)} type="number" min={1} max={99} value={copies} onChange={e => setCopies(Math.min(99, Math.max(1, Number(e.target.value) || 1)))} />
                </label>
                <label {...stylex.props(s.check)} htmlFor="grayscale">
                  <input id="grayscale" type="checkbox" checked={grayscale} onChange={e => setGrayscale(e.target.checked)} style={{ width: 16, height: 16, accentColor: vars.blue as string }} />
                  Black & white
                </label>
              </div>

              <button type="submit" disabled={printBusy} {...stylex.props(s.buttonPrimary)} style={{ marginTop: 14 }}>
                {printBusy ? <><Loader2 size={16} className="spin" /> Sending to printer…</> : <><Printer size={16} /> Print file</>}
              </button>

              {printBusy ? (
                <div style={{ marginTop: 10 }}>
                  <div {...stylex.props(s.progress)}><span {...stylex.props(s.progressBar)} /></div>
                  <div {...stylex.props(s.opCopy)}><strong {...stylex.props(s.opCopyStrong)}>{printStages[printStage]}</strong><span>working…</span></div>
                </div>
              ) : null}
            </form>
          </article>

          {/* Scan */}
          <article {...stylex.props(s.card, s.cardPad)}>
            <div {...stylex.props(s.taskHead)}>
              <span {...stylex.props(s.taskIcon, s.taskIconScan)} aria-hidden="true"><ScanLine size={18} /></span>
              <div><p {...stylex.props(s.cardKicker, s.cardKickerTeal)}>Scan</p><h2 {...stylex.props(s.cardTitle)}>Make a digital copy</h2></div>
            </div>

            {scanner.ok ? (
              <form onSubmit={handleScan}>
                <div {...stylex.props(s.scanOptions)}>
                  <label {...stylex.props(s.fieldLabel)}>Colour
                    <select {...stylex.props(s.input)} value={scanMode} onChange={e => setScanMode(e.target.value)}>
                      <option>Color</option><option>Gray</option><option>Lineart</option>
                    </select>
                  </label>
                  <label {...stylex.props(s.fieldLabel)}>Quality
                    <select {...stylex.props(s.input)} value={scanDpi} onChange={e => setScanDpi(e.target.value)}>
                      <option value="150">Quick (150)</option><option value="200">Standard (200)</option><option value="300">High (300)</option><option value="600">Very high (600)</option>
                    </select>
                  </label>
                  <label {...stylex.props(s.fieldLabel)}>Save as
                    <select {...stylex.props(s.input)} value={scanFmt} onChange={e => setScanFmt(e.target.value)}>
                      <option value="pdf">PDF</option><option value="png">PNG</option><option value="jpg">JPG</option>
                    </select>
                  </label>
                </div>
                <p {...stylex.props(s.helpText)}>Place the document face-down on the glass, then press scan. The file will appear below as a download.</p>
                <button type="submit" disabled={scanBusy} {...stylex.props(s.buttonPrimary, s.buttonTeal)}>
                  {scanBusy ? <><Loader2 size={16} className="spin" /> Scanning… this can take a minute</> : <><Scan size={16} /> Scan document</>}
                </button>
                {scanBusy ? (
                  <div style={{ marginTop: 10 }}>
                    <div {...stylex.props(s.progress)}><span {...stylex.props(s.progressBar, s.progressBarTeal)} /></div>
                    <div {...stylex.props(s.opCopy)}><strong {...stylex.props(s.opCopyStrong)}>{scanStages[scanStage]}</strong><span>…</span></div>
                  </div>
                ) : null}
              </form>
            ) : (
              <div {...stylex.props(s.emptyScan)}>
                <strong style={{ fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}><Loader2 size={16} className="spin" /> Scanner is starting</strong>
                <p style={{ margin: "8px 0 0", color: "#92400e", fontSize: 13, lineHeight: 1.5 }}>The scanner service sets itself up automatically. Check again in a minute — or try a scan anyway; we'll validate it succeeded.</p>
                <form onSubmit={handleScan} style={{ marginTop: 14, opacity: .85 }}>
                  <div {...stylex.props(s.scanOptions)}>
                    <label {...stylex.props(s.fieldLabel)}>Colour<select {...stylex.props(s.input)} value={scanMode} onChange={e => setScanMode(e.target.value)}><option>Color</option><option>Gray</option><option>Lineart</option></select></label>
                    <label {...stylex.props(s.fieldLabel)}>Quality<select {...stylex.props(s.input)} value={scanDpi} onChange={e => setScanDpi(e.target.value)}><option value="150">Quick</option><option value="200">Standard</option><option value="300">High</option><option value="600">Very high</option></select></label>
                    <label {...stylex.props(s.fieldLabel)}>Save as<select {...stylex.props(s.input)} value={scanFmt} onChange={e => setScanFmt(e.target.value)}><option value="pdf">PDF</option><option value="png">PNG</option><option value="jpg">JPG</option></select></label>
                  </div>
                  <button type="submit" disabled={scanBusy} {...stylex.props(s.buttonPrimary, s.buttonTeal)} style={{ marginTop: 10 }}>{scanBusy ? "Scanning…" : "Try scan anyway"}</button>
                </form>
              </div>
            )}
          </article>
        </section>

        {/* Status strip */}
        <section {...stylex.props(s.card, s.statusStrip)} aria-label="Current devices">
          <div {...stylex.props(s.deviceCell)}>
            <Dot ok={!!printer.ok} />
            <span><small {...stylex.props(s.deviceLabelSmall)}>Printer</small><strong {...stylex.props(s.deviceLabelStrong)}>{printer.state.replace("_", " ")}</strong></span>
            <span {...stylex.props(s.deviceDetail)}>{displayName} · {printerIp}</span>
          </div>
          <div {...stylex.props(s.deviceCell)}>
            <Dot ok={!!scanner.ok} warn={!scanner.ok} />
            <span><small {...stylex.props(s.deviceLabelSmall)}>Scanner</small><strong {...stylex.props(s.deviceLabelStrong)}>{scanner.ok ? "Ready" : "Starting"}</strong></span>
            <span {...stylex.props(s.deviceDetail)}>{scanner.ok ? (scanner.backend || "Ready") : "Automatic setup in progress"}</span>
          </div>
          <div {...stylex.props(s.deviceCell)} style={{ borderRightWidth: 0 }}>
            <Dot ok={queue.length === 0} warn={queue.length > 0} />
            <span><small {...stylex.props(s.deviceLabelSmall)}>Print queue</small><strong {...stylex.props(s.deviceLabelStrong)}>{queue.length} {queue.length === 1 ? "job" : "jobs"}</strong></span>
            <span {...stylex.props(s.deviceDetail)}>{queue.length ? "Working through the queue" : "Nothing waiting"}</span>
          </div>
        </section>

        <div {...stylex.props(s.live)} aria-live="polite" aria-atomic="true">
          <span {...stylex.props(s.liveDot, historyQ.isError || isError ? s.liveDotError : undefined)} />
          <span>{historyQ.isError ? "Retrying…" : "Live"}</span>
          <span style={{ fontWeight: 400, fontVariantNumeric: "tabular-nums" }}>· updated {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
          <button {...stylex.props(s.buttonQuiet)} style={{ marginLeft: "auto", padding: "6px 10px", fontSize: 11 }} onClick={() => { qc.invalidateQueries({ queryKey: ["status"] }); qc.invalidateQueries({ queryKey: ["history"] }); }}><RefreshCw size={12} /> Refresh</button>
        </div>

        {/* Activity */}
        <section {...stylex.props(s.activityGrid)} aria-label="Activity">
          <article {...stylex.props(s.card, s.cardPad)} hidden={queue.length === 0} style={{ display: queue.length === 0 ? "none" : undefined }}>
            <div {...stylex.props(s.compactHead)}><div><p {...stylex.props(s.kicker)}>In progress</p><h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Print queue</h2></div><span style={{ fontSize: 11, color: vars.textFaint as string, fontWeight: 700 }}>{queue.length}</span></div>
            <div {...stylex.props(s.itemList)}>
              {queue.map(j => (
                <div key={j.id} {...stylex.props(s.itemRow)}>
                  <span style={{ minWidth: 0 }}><strong style={{ fontSize: 13, display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>{j.id}</strong><small style={{ color: vars.textMuted as string, fontSize: 11 }}>{j.owner} · {j.size}</small></span>
                  <button {...stylex.props(s.buttonQuiet, s.buttonDanger)} onClick={() => handleCancel(j.id)}><Trash2 size={12} /> Cancel</button>
                </div>
              ))}
            </div>
          </article>

          <article {...stylex.props(s.card, s.cardPad)} hidden={scans.length === 0} style={{ display: scans.length === 0 ? "none" : undefined }}>
            <div {...stylex.props(s.compactHead)}><div><p {...stylex.props(s.kicker)}>Downloads</p><h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Recent scans</h2></div></div>
            <div {...stylex.props(s.itemList)}>
              {scans.map(name => (
                <a key={name} href={`/scans/${encodeURIComponent(name)}`} {...stylex.props(s.itemRow)}>
                  <span style={{ minWidth: 0 }}><strong style={{ fontSize: 13, display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</strong><small style={{ color: vars.textMuted as string, fontSize: 11 }}>Saved scan</small></span>
                  <span {...stylex.props(s.downloadLink)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Download <ExternalLink size={12} /></span>
                </a>
              ))}
              {scans.length === 0 ? <p style={{ color: vars.textMuted as string, fontSize: 12, margin: 0, padding: "12px 0" }}>No scans yet — your downloads will appear here.</p> : null}
            </div>
          </article>
        </section>

        {/* Network sharing */}
        <details {...stylex.props(s.card, s.fold)} open={networkSharing}>
          <summary {...stylex.props(s.foldSummary)}>
            <span><strong {...stylex.props(s.foldTitle)}>Connect phones and computers</strong><small {...stylex.props(s.foldSub)}>Share this printer around the house</small></span>
            <span {...stylex.props(s.foldBadge, networkSharing ? s.foldBadgeOn : undefined)}>{networkSharing ? <><Wifi size={12} /> Sharing on</> : <><WifiOff size={12} /> Sharing off</>}</span>
            <ChevronDown size={16} style={{ color: vars.textFaint as string }} />
          </summary>
          <div {...stylex.props(s.foldContent)}>
            <div {...stylex.props(s.networkGrid)}>
              <form onSubmit={handleNetworkSave} {...stylex.props(s.stack)}>
                <label {...stylex.props(s.fieldLabel)} htmlFor="display-name">Printer name
                  <input id="display-name" {...stylex.props(s.input)} value={displayNameEdit} onChange={e => setDisplayNameEdit(e.target.value)} maxLength={80} required />
                </label>
                <label {...stylex.props(s.fieldLabel)} htmlFor="queue-name">Technical queue name
                  <input id="queue-name" {...stylex.props(s.input)} value={queueNameEdit} onChange={e => setQueueNameEdit(e.target.value)} pattern="[A-Za-z0-9._-]+" maxLength={127} required />
                </label>
                <label {...stylex.props(s.toggle)} htmlFor="share-toggle">
                  <input id="share-toggle" type="checkbox" checked={shareEdit} onChange={e => setShareEdit(e.target.checked)} style={{ width: 18, height: 18, accentColor: vars.blue as string, marginTop: 2 }} />
                  <span>
                    <strong style={{ display: "block", fontSize: 13 }}>Share on the home network</strong>
                    <small style={{ display: "block", color: vars.textMuted as string, fontWeight: 400, marginTop: 2 }}>Allows AirPrint, Windows and Linux devices to find it via Bonjour/mDNS.</small>
                  </span>
                </label>
                <button type="submit" disabled={netBusy} {...stylex.props(s.buttonPrimary)} style={{ justifySelf: "start", width: "auto", padding: "10px 16px" }}>
                  {netBusy ? <><Loader2 size={14} className="spin" /> Saving…</> : "Save sharing settings"}
                </button>
                {netBusy ? <div><div {...stylex.props(s.progress)}><span {...stylex.props(s.progressBar)} /></div><div {...stylex.props(s.opCopy)}><strong {...stylex.props(s.opCopyStrong)}>{netStages[netStage]}</strong></div></div> : null}
              </form>

              <div>
                {networkSharing ? (
                  <>
                    <h3 style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 800 }}>Automatic setup</h3>
                    <p style={{ margin: "0 0 14px", color: vars.textMuted as string, fontSize: 13 }}>On most devices, add a printer and choose <strong>{displayName}</strong> from the list.</p>
                    <h3 style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 800 }}>Manual address</h3>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <code {...stylex.props(s.codeBox)}>{ippUri}</code>
                      <button type="button" {...stylex.props(s.buttonQuiet)} onClick={() => copy(ippUri, "Manual URI copied")}><Copy size={12} /> Copy</button>
                    </div>
                    <details style={{ marginTop: 14 }}>
                      <summary style={{ color: vars.blue as string, fontSize: 12, fontWeight: 800, cursor: "pointer" }}>Windows and Mac instructions</summary>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 12, "@media (max-width: 640px)": { gridTemplateColumns: "1fr" } } as any}>
                        <div><h4 style={{ margin: "0 0 4px", fontSize: 13 }}>Windows</h4><p style={{ margin: 0, color: vars.textMuted as string, fontSize: 12, lineHeight: 1.5 }}>Settings → Bluetooth & devices → Printers & scanners → Add device. If needed, add manually with <code>{httpUri}</code>.</p></div>
                        <div><h4 style={{ margin: "0 0 4px", fontSize: 13 }}>Mac</h4><p style={{ margin: 0, color: vars.textMuted as string, fontSize: 12, lineHeight: 1.5 }}>System Settings → Printers & Scanners → Add Printer, then choose <strong>{displayName}</strong>.</p></div>
                      </div>
                    </details>
                  </>
                ) : (
                  <>
                    <h3 style={{ margin: "0 0 6px", fontSize: 14 }}>Sharing is off</h3>
                    <p style={{ margin: 0, color: vars.textMuted as string, fontSize: 13 }}>Turn it on to let other devices find and use this printer over IPP.</p>
                  </>
                )}
              </div>
            </div>
          </div>
        </details>

        {/* History */}
        <details {...stylex.props(s.card, s.fold)} open>
          <summary {...stylex.props(s.foldSummary)}>
            <span><strong {...stylex.props(s.foldTitle)} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><History size={14} /> Print history</strong><small {...stylex.props(s.foldSub)}>{history.length} recent {history.length === 1 ? "job" : "jobs"} · file contents are not stored</small></span>
            <span style={{ color: vars.textFaint as string, fontSize: 11 }}>{historyQ.isFetching ? <Loader2 size={14} className="spin" /> : null}</span>
            <ChevronDown size={16} style={{ color: vars.textFaint as string }} />
          </summary>
          <div {...stylex.props(s.foldContent)} style={{ padding: 0 }}>
            <div style={{ padding: "14px 16px", display: "flex", gap: 10, alignItems: "center", borderBottom: `1px solid ${vars.line}` }}>
              <div style={{ position: "relative", flex: 1 }}>
                <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: vars.textFaint as string }} />
                <input {...stylex.props(s.input)} placeholder="Search documents, users, status…" value={historyFilter} onChange={e => setHistoryFilter(e.target.value)} style={{ marginTop: 0, paddingLeft: 32, minHeight: 36 }} />
              </div>
              {history.length > 30 ? <button {...stylex.props(s.buttonQuiet)} onClick={() => setShowAllHistory(v => !v)}>{showAllHistory ? "Show less" : `Show all (${filteredHistory.length})`}</button> : null}
            </div>

            {visibleHistory.length ? (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: vars.textMuted as string }}>
                      <th style={{ padding: "10px 14px", fontSize: 10, letterSpacing: ".06em", textTransform: "uppercase", fontWeight: 700, borderBottom: `1px solid ${vars.line}` }}>Document</th>
                      <th style={{ padding: "10px 14px", fontSize: 10, letterSpacing: ".06em", textTransform: "uppercase", fontWeight: 700, borderBottom: `1px solid ${vars.line}` }}>When</th>
                      <th style={{ padding: "10px 14px", fontSize: 10, letterSpacing: ".06em", textTransform: "uppercase", fontWeight: 700, borderBottom: `1px solid ${vars.line}` }}>From</th>
                      <th style={{ padding: "10px 14px", fontSize: 10, letterSpacing: ".06em", textTransform: "uppercase", fontWeight: 700, borderBottom: `1px solid ${vars.line}` }}>Status</th>
                      <th style={{ padding: "10px 14px", fontSize: 10, letterSpacing: ".06em", textTransform: "uppercase", fontWeight: 700, borderBottom: `1px solid ${vars.line}` }}>Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleHistory.map(j => (
                      <tr key={`${j.job_id}-${j.created_at}`}>
                        <td style={{ padding: "11px 14px", borderBottom: `1px solid ${vars.line}` }}>
                          <strong style={{ display: "block", fontSize: 13 }}>{j.document}</strong><small style={{ color: vars.textMuted as string }}>#{j.job_id}</small>
                        </td>
                        <td style={{ padding: "11px 14px", borderBottom: `1px solid ${vars.line}`, whiteSpace: "nowrap" }}>{j.created_display}</td>
                        <td style={{ padding: "11px 14px", borderBottom: `1px solid ${vars.line}`, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{j.origin_host || j.user_name || j.source}</td>
                        <td style={{ padding: "11px 14px", borderBottom: `1px solid ${vars.line}` }}>
                          <span style={{
                            display: "inline-block", padding: "4px 8px", borderRadius: 999, fontSize: 10, fontWeight: 800,
                            background: j.state === "completed" ? "#ecfdf5" : j.state === "pending" || j.state === "printing" ? "#eff6ff" : j.state === "cancelled" || j.state === "aborted" ? "#fef2f2" : j.state === "held" ? "#fffbeb" : "#f1f5f9",
                            color: j.state === "completed" ? "#065f46" : j.state === "pending" || j.state === "printing" ? "#1e40af" : j.state === "cancelled" || j.state === "aborted" ? "#991b1b" : j.state === "held" ? "#92400e" : "#475569",
                            border: "1px solid rgba(0,0,0,.06)"
                          }}>{j.state.replace("_", " ")}</span>
                        </td>
                        <td style={{ padding: "11px 14px", borderBottom: `1px solid ${vars.line}`, whiteSpace: "nowrap" }}>{j.size_display}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ margin: 0, padding: "20px 16px", color: vars.textMuted as string, fontSize: 13 }}>{historyFilter ? `No jobs match “${historyFilter}”.` : "No print history yet. Jobs from phones, laptops and this page will appear here."}</p>
            )}
          </div>
        </details>

        {/* Printer settings */}
        <details {...stylex.props(s.card, s.fold)}>
          <summary {...stylex.props(s.foldSummary)}>
            <span><strong {...stylex.props(s.foldTitle)} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Settings2 size={14} /> Printer settings</strong><small {...stylex.props(s.foldSub)}>Change the printer address</small></span>
            <ChevronDown size={16} style={{ color: vars.textFaint as string }} />
          </summary>
          <div {...stylex.props(s.foldContent)}>
            <form onSubmit={handleChangeIp} style={{ maxWidth: 520, display: "grid", gap: 12 }}>
              <label {...stylex.props(s.fieldLabel)} htmlFor="change-ip">Printer IP address
                <input id="change-ip" {...stylex.props(s.input)} value={changeIp} onChange={e => setChangeIp(e.target.value)} placeholder="192.168.1.50" inputMode="decimal" required />
              </label>
              <button type="submit" disabled={setupBusy} {...stylex.props(s.buttonPrimary)} style={{ width: "auto", justifySelf: "start", padding: "10px 16px" }}>
                {setupBusy ? <><Loader2 size={14} className="spin" /> Saving…</> : "Save address"}
              </button>
              {setupBusy ? <div><div {...stylex.props(s.progress)}><span {...stylex.props(s.progressBar)} /></div><div {...stylex.props(s.opCopy)}><strong {...stylex.props(s.opCopyStrong)}>{setupStages[setupStage]}</strong></div></div> : null}
            </form>
          </div>
        </details>

        <div {...stylex.props(s.footer)}>Private home service · Keep this hub and your printer on the local network. · Lightning-fast Bun + StyleX build</div>
      </main>

      <style>{`@keyframes indeterminate{from{transform:translateX(-110%)}to{transform:translateX(305%)}} .spin{animation:spin 1s linear infinite} @keyframes spin{to{transform:rotate(360deg)}} details[open] > summary svg:last-child{transform:rotate(180deg)} summary svg:last-child{transition:transform .15s}`}</style>
    </div>
  );
}
