import { SectionBoundary } from "./components/SectionBoundary";
import { Maintenance } from "./components/Maintenance";
import * as stylex from "@stylexjs/stylex";
import { vars } from "./styles/tokens.stylex";
import { useEffect, useState, lazy, Suspense, type ReactNode } from "react";
import { Clock, FolderOpen, History as HistoryIcon, LayoutGrid, RefreshCw, Settings as SettingsIcon, ShieldAlert } from "lucide-react";
import { useStatus, useHistory, useScans } from "./hooks/useStatus";
import { useToast } from "./components/Toast";
import { useQueryClient } from "@tanstack/react-query";
import { Header } from "./components/Header";
import { PrintCard } from "./components/PrintCard";
import { ScanCard } from "./components/ScanCard";
import { StatusStrip, Queue, PrinterUnreachableBanner } from "./components/Overview";
import { InkLevels } from "./components/InkLevels";
import { SharingSettings, PrinterAddressSettings, AdvancedDiagnostics } from "./components/Settings";
import { refreshStatus, type ScanItem } from "./lib/api";

const Library = lazy(() => import("./components/Library").then(m => ({ default: m.Library })));
const History = lazy(() => import("./components/History").then(m => ({ default: m.History })));
const PreviewModal = lazy(() => import("./components/PreviewModal").then(m => ({ default: m.PreviewModal })));
const sectionInfo = {
 overview: { title: "Print & scan", description: "Send a document or turn a paper page into a file." },
 scans: { title: "Saved scans", description: "Preview, download and organise the pages saved on your hub." },
 history: { title: "Print history", description: "Your recent documents, with progress and results." },
 settings: { title: "Printer settings", description: "Connect your printer and share it across your home." },
};
function SectionLoading() { return <div className="section-loading" role="status">Opening this view…</div>; }

const s = stylex.create({
  page: { backgroundColor: vars.bg, color: vars.text, minHeight: "100vh", fontFamily: vars.fontSans },
  main: { maxWidth: "1080px", margin: "0 auto", padding: "28px 24px 48px", "@media (max-width: 600px)": { padding: "20px 16px 32px" } },
  hero: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", marginBottom: "24px", flexWrap: "wrap" },
  eyebrow: { fontSize: "11px", fontWeight: 650, letterSpacing: "0.12em", color: vars.textTertiary, textTransform: "uppercase", marginBottom: "6px" },
  heading: { fontSize: "30px", fontWeight: 680, letterSpacing: "-0.035em", lineHeight: 1.15, "@media (max-width: 600px)": { fontSize: "26px" } },
  intro: { color: vars.textSecondary, fontSize: "14px", marginTop: "8px", lineHeight: 1.5 },
  checking: { color: vars.textSecondary, backgroundColor: vars.accentSoft, padding: "8px 12px", borderRadius: vars.radiusFull, fontSize: "12px", display: "flex", alignItems: "center", gap: "6px" },
  actionGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "16px",
    marginTop: "16px",
    "@media (max-width: 760px)": { gridTemplateColumns: "1fr" },
  },
  stack: { display: "grid", gap: "16px", marginTop: "16px" },
  tabs: {
    display: "flex",
    gap: "4px",
    flexWrap: "nowrap",
    overflowX: "auto",
    padding: "5px",
    borderRadius: vars.radiusMd,
    backgroundColor: vars.bgSunken,
    marginTop: "20px",
    "@media (max-width: 600px)": { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))" },
  },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    gap: "7px",
    padding: "11px 16px",
    borderRadius: vars.radiusSm,
    minHeight: "44px",
    position: "relative",
    "@media (max-width: 600px)": { flexDirection: "column", justifyContent: "center", padding: "9px 4px", gap: "5px", fontSize: "11px" },
    whiteSpace: "nowrap",
    flexShrink: 0,
    borderWidth: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    fontFamily: vars.fontSans,
    fontSize: "13.5px",
    fontWeight: 550,
    color: vars.textTertiary,
    cursor: "pointer",
    borderBottomWidth: "2px",
    borderBottomStyle: "solid",
    borderBottomColor: "transparent",
    marginBottom: "-1px",
  },
  tabActive: { color: vars.accent, backgroundColor: vars.panel, boxShadow: vars.shadowSm },
  tabCount: {
    fontFamily: vars.fontMono,
    fontSize: "11px",
    backgroundColor: vars.bgSunken,
    color: vars.textSecondary,
    borderRadius: vars.radiusFull,
    padding: "1px 7px",
    "@media (max-width: 600px)": { position: "absolute", top: "5px", right: "5px", fontSize: "9px", padding: "0 4px" },
  },
  liveRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginTop: "16px",
    fontFamily: vars.fontMono,
    fontSize: "11.5px",
    color: vars.textTertiary,
  },
  refreshBtn: { marginLeft: "auto" },
  skeleton: { borderRadius: vars.radiusMd, backgroundColor: vars.bgSunken },
  errorWrap: { maxWidth: "480px", margin: "72px auto 0", padding: "0 20px" },
  errorTitle: { fontFamily: vars.fontSans, fontSize: "18px", fontWeight: 650, color: vars.text, marginTop: "16px" },
  errorBody: { fontFamily: vars.fontMono, fontSize: "12px", color: vars.textSecondary, marginTop: "8px", lineHeight: 1.5 },
  footer: {
    marginTop: "40px",
    paddingTop: "16px",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: vars.line,
    fontFamily: vars.fontMono,
    fontSize: "11px",
    color: vars.textTertiary,
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    flexWrap: "wrap",
  },
});

type Tab = "overview" | "scans" | "history" | "settings";

function refreshAll(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ["status"] }),
    qc.invalidateQueries({ queryKey: ["history"] }),
    qc.invalidateQueries({ queryKey: ["scans"] }),
    qc.invalidateQueries({ queryKey: ["ink"] }),
  ]);
}

export default function App() {
  const { data, isLoading, isError, error, refetch, dataUpdatedAt } = useStatus(true);
  const qc = useQueryClient();
  const { push } = useToast();

  const printerIp = data?.printer_ip || "";
  const printerName = data?.printer_name || "Home_Epson_XP2200";
  const displayName = data?.display_name || "Home Epson XP-2200";
  const reachable = !!data?.reachable;
  const parts = data?.status_meta?.parts;
  const reachChecked = !parts || !!parts.reachable?.updated_at;
  const statusPending = !!data?.status_meta?.refreshing;
  const statusStale = !!parts?.reachable?.stale;
  const printer = data?.printer || { ok: false, state: "setup_required", detail: "" };
  const scanner = data?.scanner || { ok: false, state: "starting", detail: "", backend: null };
  const queue = data?.queue || [];
  const networkSharing = !!data?.network_sharing;
  const initialInk = data?.ink ?? null;

  const host = data?.client_setup?.host || window.location.hostname;
  const readTab = (): Tab => {
    const hash = window.location.hash.slice(1);
    return ["overview", "scans", "history", "settings"].includes(hash) ? hash as Tab : "overview";
  };
  const [tab, setTab] = useState<Tab>(readTab);
  const historyQ = useHistory(100, tab === "history");
  const history = historyQ.data?.history || [];
  useEffect(() => {
    const update = () => { if (["overview", "scans", "history", "settings"].includes(window.location.hash.slice(1))) setTab(readTab()); };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  const [refreshing, setRefreshing] = useState(false);
  const [previewScan, setPreviewScan] = useState<ScanItem | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const scansQ = useScans(100, !!printerIp && tab === "scans");
  const scans: ScanItem[] = (scansQ.data?.scans as ScanItem[]) || [];
  const scansTotal = scansQ.data?.total ?? scans.length;
  const scansMax = scansQ.data?.max ?? 100;

  // keep preview in sync if the file is renamed/deleted underneath
  useEffect(() => {
    if (previewScan && !scans.some((x) => x.name === previewScan.name)) setPreviewScan(null);
  }, [scans, previewScan]);

  if (isLoading) {
    return (
      <div {...stylex.props(s.page)}>
        <Header printerName={printerName} displayName={displayName} online={false} checking setupNeeded={false} />
        <main tabIndex={-1} id="main-content" {...stylex.props(s.main)}>
          <div {...stylex.props(s.skeleton)} className="loading-placeholder" style={{ height: 86 }} />
          <div {...stylex.props(s.actionGrid)}>
            <div {...stylex.props(s.skeleton)} className="loading-placeholder" style={{ height: 320 }} />
            <div {...stylex.props(s.skeleton)} className="loading-placeholder" style={{ height: 320 }} />
          </div>
          <p className="section-loading" role="status">Opening Print Room…</p>
        </main>
      </div>
    );
  }

  if (isError && !data) {
    const msg = (error as any)?.message || "";
    const isAuth = msg.includes("401") || msg.toLowerCase().includes("authentication");
    return (
      <div {...stylex.props(s.page)}>
        <Header printerName={printerName} displayName={displayName} online={false} checking setupNeeded={false} />
        <main tabIndex={-1} id="main-content" {...stylex.props(s.main)}>
          <div {...stylex.props(s.errorWrap)}>
            <ShieldAlert size={28} style={{ color: vars.bad as string }} />
            <h1 {...stylex.props(s.errorTitle)}>{isAuth ? "Authentication required" : "Couldn't reach Print Room"}</h1>
            <p {...stylex.props(s.errorBody)}>{isAuth ? "Check WEB_USERNAME / WEB_PASSWORD." : msg || "The server isn't responding."}</p>
            <div style={{ marginTop: 18 }}>
              <button
                onClick={() => refetch()}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8, minHeight: 40, padding: "0 18px",
                  borderRadius: 8, border: "1px solid transparent", backgroundColor: vars.accent as string,
                  color: vars.onAccent as string, fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}
              >
                <RefreshCw size={15} /> Retry
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!printerIp) {
    return (
      <div {...stylex.props(s.page)}>
        <Header printerName={printerName} displayName={displayName} online={false} setupNeeded />
        <main tabIndex={-1} id="main-content" {...stylex.props(s.main)}>
          <PrinterAddressSettings printerIp="" recovery={data?.recovery} onSaved={() => refreshAll(qc)} />
          <footer {...stylex.props(s.footer)}>
            <span>Print Room · Epson XP-2200</span>
            <span>{data?.build_number ? `Build ${data.build_number} · ` : ""}Local network only</span>
          </footer>
        </main>
      </div>
    );
  }

  const tabs: Array<{ id: Tab; label: string; icon: ReactNode; count?: number }> = [
    { id: "overview", label: "Print & scan", icon: <LayoutGrid size={14} /> },
    { id: "scans", label: "Saved scans", icon: <FolderOpen size={14} />, count: scansQ.data ? scansTotal : undefined },
    { id: "history", label: "Print history", icon: <HistoryIcon size={14} />, count: historyQ.data ? history.length : undefined },
    { id: "settings", label: "Settings", icon: <SettingsIcon size={14} /> },
  ];

  return (
    <div {...stylex.props(s.page)}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <Header printerName={printerName} displayName={displayName} online={reachable} checking={!reachChecked} stale={statusStale || isError} setupNeeded={false} />
      <main tabIndex={-1} id="main-content" {...stylex.props(s.main)}>
        <div {...stylex.props(s.hero)}>
          <div><p {...stylex.props(s.eyebrow)}>{displayName}</p><h1 {...stylex.props(s.heading)}>{sectionInfo[tab].title}</h1><p {...stylex.props(s.intro)}>{sectionInfo[tab].description}</p></div>
          {statusPending ? <span {...stylex.props(s.checking)} role="status"><RefreshCw size={12} className="spin" /> Updating devices in the background</span> : null}
        </div>
        <StatusStrip
          printerChecking={!reachChecked || statusStale || !!parts?.device?.stale || !!parts?.printer?.stale}
          scannerChecking={!!parts && (!parts.scanner?.updated_at || parts.scanner.stale)}
          queueChecking={!!parts && !parts.queue?.updated_at}
          printerOk={reachable && !!printer.ok}
          printerState={data?.device?.state || printer.state}
          printerDetail={`${displayName} · ${printerIp}`}
          scannerOk={!!scanner.ok}
          scannerState={scanner.state}
          scannerDetail={scanner.detail || (scanner.ok ? "Ready" : scanner.state.replaceAll("_", " "))}
          queueCount={queue.length}
        />

        <nav {...stylex.props(s.tabs)} aria-label="Sections">
          {tabs.map((t) => (
            <button
              key={t.id}
              {...stylex.props(s.tab, tab === t.id && s.tabActive)}
              onClick={() => { window.location.hash = t.id; setTab(t.id); }}
              aria-current={tab === t.id ? "page" : undefined}
            >
              {t.icon} {t.label}
              {typeof t.count === "number" ? <span {...stylex.props(s.tabCount)}>{t.count}</span> : null}
            </button>
          ))}
        </nav>

        <section hidden={tab !== "overview"} aria-label="Print and scan">
            {printerIp && reachChecked && !reachable && !statusStale ? (
              <div {...stylex.props(s.stack)}>
                <PrinterUnreachableBanner recoveryMessage={data?.recovery?.message} network={data?.printer_network ?? null} queuedJobs={queue.length} />
              </div>
            ) : null}
            <div {...stylex.props(s.actionGrid)}>
              <PrintCard onPrinted={() => refreshAll(qc)} maxMb={data?.max_upload_mb} />
              <ScanCard scannerOk={!!scanner.ok} scannerDetail={scanner.detail} capabilities={data?.scanner.capabilities} onScanned={() => refreshAll(qc)} />
            </div>
            {queue.length > 0 ? (
              <div {...stylex.props(s.stack)}>
                <Queue jobs={queue} onChanged={() => refreshAll(qc)} />
              </div>
            ) : null}
            <div {...stylex.props(s.stack)}>
              <InkLevels key={printerIp} initial={initialInk} stale={parts?.ink?.stale} />
              <Maintenance capabilities={data?.printer_capabilities} onChanged={() => refreshAll(qc)} />
            </div>
        </section>

        {tab === "scans" ? (
          <div {...stylex.props(s.stack)}>
            {scansQ.isError ? <p role="alert">Couldn’t load saved scans: {scansQ.error.message} <button onClick={() => scansQ.refetch()}>Retry</button></p> : null}
            <SectionBoundary key={tab}><Suspense fallback={<SectionLoading />}><Library
              scans={scans}
              total={scansTotal}
              max={scansMax}
              now={now}
              loading={scansQ.isLoading}
              onChanged={() => refreshAll(qc)}
              onPreview={setPreviewScan}
            /></Suspense></SectionBoundary>
          </div>
        ) : null}

        {tab === "history" ? (
          <div {...stylex.props(s.stack)}>
            {historyQ.isError ? <p role="alert">Couldn’t load print history: {historyQ.error.message} <button onClick={() => historyQ.refetch()}>Retry</button></p> : null}
            {!historyQ.isError && historyQ.isLoading ? <output>Loading print history…</output> : null}
            {!historyQ.isError && !historyQ.isLoading ? <SectionBoundary key={tab}><Suspense fallback={<SectionLoading />}><History items={history} /></Suspense></SectionBoundary> : null}
          </div>
        ) : null}

        {tab === "settings" ? (
          <div {...stylex.props(s.stack)}>
            <PrinterAddressSettings recovery={data?.recovery} printerIp={printerIp} onSaved={() => refreshAll(qc)} />
            <SharingSettings
              displayName={displayName}
              printerName={printerName}
              sharing={networkSharing}
              host={host}
              onSaved={() => refreshAll(qc)}
            />
            <AdvancedDiagnostics onChanged={() => refreshAll(qc)} />
          </div>
        ) : null}

        <div {...stylex.props(s.liveRow)}>
          <Clock size={12} />
          <span>
            Status received {new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            {isError ? " · Connection lost; showing last known status" : statusPending ? " · Updating in background" : statusStale ? " · Last known status" : ""}
          </span>
          <span {...stylex.props(s.refreshBtn)}>
            <button
              disabled={refreshing || statusPending}
              onClick={async () => { setRefreshing(true); try { qc.setQueryData(["status"], await refreshStatus()); await refreshAll(qc); } catch { push({ kind: "error", title: "Could not refresh status", desc: "Showing the last known status. Try again shortly." }); } finally { setRefreshing(false); } }}
              aria-label="Refresh all data"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8,
                border: `1px solid ${vars.line}`, background: "transparent",
                color: vars.textSecondary as string, fontSize: 12, cursor: "pointer",
              }}
            >
              <RefreshCw size={12} className={refreshing || statusPending ? "spin" : undefined} /> {refreshing || statusPending ? "Updating…" : "Refresh status"}
            </button>
          </span>
        </div>

        <footer {...stylex.props(s.footer)}>
          <span>Print Room · {displayName} · {printerIp}</span>
          <span>{data?.build_number ? `Build ${data.build_number} · ` : ""}Local network only</span>
        </footer>
      </main>

      {previewScan ? <SectionBoundary key={tab}><Suspense fallback={<SectionLoading />}><PreviewModal scan={previewScan} onClose={() => setPreviewScan(null)} /></Suspense></SectionBoundary> : null}
    </div>
  );
}
