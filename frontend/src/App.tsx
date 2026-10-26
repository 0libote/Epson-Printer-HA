import { WorkspaceNavigation } from "./components/WorkspaceNavigation";
import { SectionBoundary } from "./components/SectionBoundary";
import { Maintenance } from "./components/Maintenance";
import * as stylex from "@stylexjs/stylex";
import { vars } from "./styles/tokens.stylex";
import { useEffect, useState, lazy, Suspense, type CSSProperties } from "react";
import { ArrowRight, Clock, ListOrdered, Printer, RefreshCw, ScanLine, ShieldAlert, Wifi } from "lucide-react";
import { useStatus, useHistory, useScans } from "./hooks/useStatus";
import { useToast } from "./components/Toast";
import { useQueryClient } from "@tanstack/react-query";
import { Header } from "./components/Header";
import { PrintCard } from "./components/PrintCard";
import { ScanCard } from "./components/ScanCard";
import { StatusStrip, Queue, QueueAttention, PrinterUnreachableBanner } from "./components/Overview";
import { InkLevels } from "./components/InkLevels";
import { SharingSettings, PrinterAddressSettings, AdvancedDiagnostics } from "./components/Settings";
import { refreshStatus, type ScanItem, type ScanSort } from "./lib/api";

const Library = lazy(() => import("./components/Library").then(m => ({ default: m.Library })));
const History = lazy(() => import("./components/History").then(m => ({ default: m.History })));
const PreviewModal = lazy(() => import("./components/PreviewModal").then(m => ({ default: m.PreviewModal })));
const sectionInfo = {
 overview: { title: "Print & scan", description: "Send a document to your printer or scan a page." },
 scans: { title: "Saved scans", description: "Preview, download and organise the pages saved on your hub." },
 history: { title: "Print history", description: "Your recent documents, with progress and results." },
 settings: { title: "Printer settings", description: "Connect your printer and share it across your home." },
};
function SectionLoading() { return <output className="section-loading">Opening this view…</output>; }

const s = stylex.create({
  page: { backgroundColor: vars.bg, color: vars.text, minHeight: "100vh", fontFamily: vars.fontSans },
  main: { maxWidth: "1180px", margin: "0 auto", padding: "28px 32px 36px", "@media (max-width: 1100px)": { padding: "28px 24px 48px" }, "@media (max-width: 600px)": { padding: "20px 16px 36px" } },
  intro: { color: vars.textSecondary, fontSize: "14px", marginTop: "8px", lineHeight: 1.5 },
  checking: { color: vars.textSecondary, backgroundColor: vars.accentSoft, padding: "8px 12px", borderRadius: vars.radiusFull, fontSize: "12px", display: "flex", alignItems: "center", gap: "6px" },
  actionGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "20px",
    marginTop: "20px",
    "@media (max-width: 760px)": { gridTemplateColumns: "1fr" },
  },
  stack: { display: "grid", gap: "16px", marginTop: "16px" },
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

function statusDescription(disconnected: boolean, pending: boolean, stale: boolean) {
  if (disconnected) return " · Connection lost; showing last known status";
  if (pending) return " · Updating in background";
  return stale ? " · Last known status" : "";
}

function nextWorkflow(current: "print" | "scan", key: string) {
  if (key === "Home") return "print";
  if (key === "End") return "scan";
  return current === "print" ? "scan" : "print";
}

function connectionLabel(checked: boolean, stale: boolean, reachable: boolean, queueReady: boolean) {
  if (!checked) return "Checking connection";
  if (stale) return "Last known connection";
  if (!reachable) return "Waiting to reconnect";
  return queueReady ? "Connected to your network" : "Connected · Queue needs attention";
}

function EmptyQueue({ failed, checking }: Readonly<{ failed: boolean; checking: boolean }>) {
  let title = "Print queue is empty";
  let message = "Your print jobs will appear here while they’re waiting or printing.";
  if (failed) {
    title = "Print queue temporarily unavailable";
    message = "The last queue check failed. Refresh status or check the hub in Settings.";
  } else if (checking) {
    title = "Checking the print queue";
    message = "Jobs will appear here once the hub has checked the queue.";
  }
  return <div className="queue-empty"><span className="queue-empty-icon"><ListOrdered size={22} strokeWidth={1.5} /></span>
    <div><h2>{title}</h2><p>{message}</p></div>
    <a href="#history">Print history <ArrowRight size={14} /></a>
  </div>;
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
  const [workflow, setWorkflow] = useState<"print" | "scan">(window.location.hash === "#scan" ? "scan" : "print");
  const historyQ = useHistory(100, tab === "history");
  const history = historyQ.data?.history || [];
  useEffect(() => {
    const update = () => { if (window.location.hash === "#scan") { setTab("overview"); setWorkflow("scan"); } else if (["overview", "scans", "history", "settings"].includes(window.location.hash.slice(1))) setTab(readTab()); };
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

  const [scanFilter, setScanFilter] = useState("");
  const [scanSort, setScanSort] = useState<ScanSort>("newest");
  const scansQ = useScans(100, !!printerIp && tab === "scans", scanFilter, scanSort);
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
          <div {...stylex.props(s.skeleton)} className={`${stylex.props(s.skeleton).className} loading-placeholder`} style={{ height: 86 }} />
          <div {...stylex.props(s.actionGrid)}>
            <div {...stylex.props(s.skeleton)} className={`${stylex.props(s.skeleton).className} loading-placeholder`} style={{ height: 320 }} />
            <div {...stylex.props(s.skeleton)} className={`${stylex.props(s.skeleton).className} loading-placeholder`} style={{ height: 320 }} />
          </div>
          <p className="section-loading" role="status">Loading printer status…</p>
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
          <div className="setup-intro"><h1>Connect your printer</h1><p>Turn on your Epson and connect it to the same network as this hub.</p></div>
          <PrinterAddressSettings printerIp="" recovery={data?.recovery} onSaved={() => refreshAll(qc)} />
          <footer {...stylex.props(s.footer)}>
            <span>Print Room · Epson XP-2200</span>
            <span>{data?.build_number ? `Build ${data.build_number} · ` : ""}Local network only</span>
          </footer>
        </main>
      </div>
    );
  }


  return (
    <div {...stylex.props(s.page)} className={`${stylex.props(s.page).className} workspace`} style={{ "--ui-on-accent": vars.onAccent, "--ui-bg": vars.bg, "--ui-panel": vars.panel, "--ui-sunken": vars.bgSunken, "--ui-text": vars.text, "--ui-muted": vars.textSecondary, "--ui-line": vars.line, "--ui-accent": vars.accent, "--ui-soft": vars.accentSoft, "--ui-border-strong": vars.lineStrong, "--ui-good": vars.good, "--ui-good-soft": vars.goodSoft, "--ui-scan": vars.teal, "--ui-scan-soft": vars.tealSoft } as CSSProperties}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <Header printerName={printerName} displayName={displayName} online={reachable} checking={!reachChecked} stale={statusStale || isError} setupNeeded={false} />
      <WorkspaceNavigation view={tab} onView={view => { window.location.hash = view; setTab(view); }} />
      <main tabIndex={-1} id="main-content" {...stylex.props(s.main)}>
        <div className="workspace-hero">
          <div><h1 className="workspace-title">{sectionInfo[tab].title}</h1><p {...stylex.props(s.intro)}>{sectionInfo[tab].description}</p></div>
        </div>
        <StatusStrip
          printerChecking={!reachChecked || statusStale || !!parts?.device?.stale || !!parts?.printer?.stale}
          scannerChecking={!!parts && (!parts.scanner?.updated_at || parts.scanner.stale)}
          queueChecking={!!parts && (!parts.queue?.updated_at || parts.queue.stale)}
          printerOk={reachable && !!printer.ok}
          printerState={data?.device?.state || printer.state}
          printerDetail={`${displayName} · ${printerIp}`}
          scannerOk={!!scanner.ok}
          scannerState={scanner.state}
          scannerDetail={scanner.detail || (scanner.ok ? "Ready" : scanner.state.replaceAll("_", " "))}
          queueCount={queue.length}
        />


        <section hidden={tab !== "overview"} aria-label="Print and scan">
            {printer.state === "disabled" ? <QueueAttention onChanged={() => refreshAll(qc)} /> : null}
            {printerIp && reachChecked && !reachable && !statusStale ? (
              <div {...stylex.props(s.stack)}>
                <PrinterUnreachableBanner recoveryMessage={data?.recovery?.message} network={data?.printer_network ?? null} queuedJobs={queue.length} />
              </div>
            ) : null}
            <div className="workbench-grid">
              <div className="workbench-panel">
                <div className="workflow-tabs" role="tablist" tabIndex={-1} aria-label="Choose an action" onKeyDown={event => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const next = nextWorkflow(workflow, event.key);
                  setWorkflow(next);
                  document.getElementById(`workflow-${next}`)?.focus();
                }}>
                  <button id="workflow-print" role="tab" aria-selected={workflow === "print"} aria-controls="print-panel" tabIndex={workflow === "print" ? 0 : -1} onClick={() => setWorkflow("print")}><Printer size={17} /> Print a document</button>
                  <button id="workflow-scan" role="tab" aria-selected={workflow === "scan"} aria-controls="scan-panel" tabIndex={workflow === "scan" ? 0 : -1} onClick={() => setWorkflow("scan")}><ScanLine size={17} /> Scan a page</button>
                </div>
                <div id="print-panel" role="tabpanel" aria-labelledby="workflow-print" hidden={workflow !== "print"}>
                  <PrintCard onPrinted={() => refreshAll(qc)} maxMb={data?.max_upload_mb} offline={reachChecked && !statusStale && !reachable} />
                </div>
                <div id="scan-panel" role="tabpanel" aria-labelledby="workflow-scan" hidden={workflow !== "scan"}>
                  <ScanCard scannerOk={!!scanner.ok} scannerDetail={scanner.detail} capabilities={data?.scanner.capabilities} storage={data?.scan_storage} onScanned={() => refreshAll(qc)} />
                </div>
              </div>
              <aside className="printer-rail" aria-label="Your printer">
                <div className="printer-summary"><h2>{displayName}</h2><p><Wifi size={14} /> {printerIp}</p><p className={`connection-label ${reachable && !statusStale ? "is-online" : ""}`}><span />{connectionLabel(reachChecked, statusStale, reachable, !!printer.ok && printer.state !== "disabled")}</p></div>
                <InkLevels key={printerIp} initial={initialInk} stale={parts?.ink?.stale} />
                <a className="device-help-link" href="#settings">Connect another device <ArrowRight size={14} /></a>
              </aside>
            </div>
            <div className="queue-area">
              {queue.length > 0 ? <Queue jobs={queue} onChanged={() => refreshAll(qc)} /> : <EmptyQueue failed={!!parts?.queue?.error} checking={!!parts && (!parts.queue?.updated_at || parts.queue.stale)} />}
            </div>
        </section>

        {tab === "scans" ? (
          <div {...stylex.props(s.stack)}>
            {scansQ.isError ? <p role="alert">Couldn’t load saved scans: {scansQ.error.message} <button onClick={() => scansQ.refetch()}>Retry</button></p> : null}
            {!scansQ.isError || scansQ.data ? <SectionBoundary key={tab}><Suspense fallback={<SectionLoading />}><Library
              scans={scans}
              total={scansTotal}
              max={scansMax}
              storage={scansQ.data?.storage}
              filter={scanFilter} onFilter={setScanFilter} sort={scanSort} onSort={setScanSort}
              matched={scansQ.data?.matched ?? scansTotal}
              hasMore={scansQ.hasNextPage} loadingMore={scansQ.isFetchingNextPage}
              searching={scansQ.isSearching}
              onLoadMore={() => scansQ.fetchNextPage()}
              now={now}
              loading={scansQ.isLoading}
              onChanged={() => refreshAll(qc)}
              onPreview={setPreviewScan}
            /></Suspense></SectionBoundary> : null}
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
            <Maintenance capabilities={data?.printer_capabilities} onChanged={() => refreshAll(qc)} />
            <AdvancedDiagnostics onChanged={() => refreshAll(qc)} />
          </div>
        ) : null}

        <div {...stylex.props(s.liveRow)}>
          <Clock size={12} />
          <span>
            {statusPending ? "Checking devices · " : ""}Status received {new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            {statusDescription(isError, statusPending, statusStale)}
          </span>
          <span {...stylex.props(s.refreshBtn)}>
            <button
              disabled={refreshing}
              onClick={async () => { setRefreshing(true); try { qc.setQueryData(["status"], await refreshStatus()); await refreshAll(qc); } catch { push({ kind: "error", title: "Could not refresh status", desc: "Showing the last known status. Try again shortly." }); } finally { setRefreshing(false); } }}
              aria-label="Refresh all data"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8,
                border: `1px solid ${vars.line}`, background: "transparent",
                color: vars.textSecondary as string, fontSize: 12, cursor: "pointer",
              }}
            >
              <RefreshCw size={12} className={refreshing ? "spin" : undefined} /> {refreshing ? "Updating…" : "Refresh status"}
            </button>
          </span>
        </div>

        <footer {...stylex.props(s.footer)}>
          <span>Print Room</span>
          <span>{data?.build_number ? `Build ${data.build_number} · ` : ""}Local network only</span>
        </footer>
      </main>

      {previewScan ? <SectionBoundary key={tab}><Suspense fallback={<SectionLoading />}><PreviewModal scan={previewScan} onClose={() => setPreviewScan(null)} /></Suspense></SectionBoundary> : null}
    </div>
  );
}
