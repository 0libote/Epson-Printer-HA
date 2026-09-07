import * as stylex from "@stylexjs/stylex";
import { vars } from "./styles/tokens.stylex";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Clock, FolderOpen, History as HistoryIcon, LayoutGrid, RefreshCw, Settings as SettingsIcon, ShieldAlert } from "lucide-react";
import { useStatus, useHistory, useScans } from "./hooks/useStatus";
import { useToast } from "./components/Toast";
import { useQueryClient } from "@tanstack/react-query";
import { Header } from "./components/Header";
import { Setup } from "./components/Setup";
import { PrintCard } from "./components/PrintCard";
import { ScanCard } from "./components/ScanCard";
import { StatusStrip, Queue } from "./components/Overview";
import { Library } from "./components/Library";
import { History } from "./components/History";
import { SharingSettings, PrinterAddressSettings } from "./components/Settings";
import { PreviewModal } from "./components/PreviewModal";
import type { ScanItem } from "./lib/api";

const s = stylex.create({
  page: { backgroundColor: vars.bg, color: vars.text, minHeight: "100vh", fontFamily: vars.fontSans },
  main: { maxWidth: "1080px", margin: "0 auto", padding: "24px 20px 64px" },
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
    marginTop: "20px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: vars.line,
  },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    gap: "7px",
    padding: "10px 14px",
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
  tabActive: { color: vars.text, borderBottomColor: vars.accent },
  tabCount: {
    fontFamily: vars.fontMono,
    fontSize: "11px",
    backgroundColor: vars.bgSunken,
    color: vars.textSecondary,
    borderRadius: vars.radiusFull,
    padding: "1px 7px",
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
  ]);
}

export default function App() {
  const { data, isLoading, isError, error, refetch } = useStatus(true);
  const historyQ = useHistory(100);
  const qc = useQueryClient();
  const { push } = useToast();

  const printerIp = data?.printer_ip || "";
  const printerName = data?.printer_name || "Home_Epson_XP2200";
  const displayName = data?.display_name || "Home Epson XP-2200";
  const reachable = !!data?.reachable;
  const printer = data?.printer || { ok: false, state: "setup_required", detail: "" };
  const scanner = data?.scanner || { ok: false, state: "starting", detail: "", backend: null };
  const queue = data?.queue || [];
  const networkSharing = !!data?.network_sharing;
  const history = historyQ.data?.history || [];

  const host = useMemo(() => {
    const h = window.location.host;
    if (h.startsWith("[")) return h.split("]")[0] + "]";
    return h.split(":")[0] || "localhost";
  }, []);

  const [tab, setTab] = useState<Tab>("overview");
  const [previewScan, setPreviewScan] = useState<ScanItem | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const scansQ = useScans(100, !!printerIp);
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
        <Header printerName={printerName} displayName={displayName} online={false} setupNeeded={false} />
        <main {...stylex.props(s.main)}>
          <div {...stylex.props(s.skeleton)} style={{ height: 86 }} />
          <div {...stylex.props(s.actionGrid)}>
            <div {...stylex.props(s.skeleton)} style={{ height: 320 }} />
            <div {...stylex.props(s.skeleton)} style={{ height: 320 }} />
          </div>
          <style>{`@keyframes pulse{0%,100%{opacity:.7}50%{opacity:.35}} [class*="skeleton"]{animation:pulse 1.6s ease-in-out infinite}`}</style>
        </main>
      </div>
    );
  }

  if (isError) {
    const msg = (error as any)?.message || "";
    const isAuth = msg.includes("401") || msg.toLowerCase().includes("authentication");
    return (
      <div {...stylex.props(s.page)}>
        <Header printerName={printerName} displayName={displayName} online={false} setupNeeded={false} />
        <main {...stylex.props(s.main)}>
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
        <main {...stylex.props(s.main)}>
          <Setup onDone={() => { refreshAll(qc); }} />
          <footer {...stylex.props(s.footer)}>
            <span>Print Room · Epson XP-2200</span>
            <span>Local network only</span>
          </footer>
        </main>
      </div>
    );
  }

  const tabs: Array<{ id: Tab; label: string; icon: ReactNode; count?: number }> = [
    { id: "overview", label: "Overview", icon: <LayoutGrid size={14} /> },
    { id: "scans", label: "Scans", icon: <FolderOpen size={14} />, count: scansTotal },
    { id: "history", label: "History", icon: <HistoryIcon size={14} />, count: history.length },
    { id: "settings", label: "Settings", icon: <SettingsIcon size={14} /> },
  ];

  return (
    <div {...stylex.props(s.page)}>
      <Header printerName={printerName} displayName={displayName} online={reachable} setupNeeded={false} />
      <main {...stylex.props(s.main)}>
        <StatusStrip
          printerOk={!!printer.ok}
          printerState={printer.state}
          printerDetail={`${displayName} · ${printerIp}`}
          scannerOk={!!scanner.ok}
          scannerDetail={scanner.ok ? scanner.backend || "Ready" : "Warming up…"}
          queueCount={queue.length}
        />

        <nav {...stylex.props(s.tabs)} aria-label="Sections">
          {tabs.map((t) => (
            <button
              key={t.id}
              {...stylex.props(s.tab, tab === t.id && s.tabActive)}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
            >
              {t.icon} {t.label}
              {typeof t.count === "number" ? <span {...stylex.props(s.tabCount)}>{t.count}</span> : null}
            </button>
          ))}
        </nav>

        {tab === "overview" ? (
          <>
            <div {...stylex.props(s.actionGrid)}>
              <PrintCard onPrinted={() => refreshAll(qc)} />
              <ScanCard scannerOk={!!scanner.ok} onScanned={() => refreshAll(qc)} />
            </div>
            {queue.length > 0 ? (
              <div {...stylex.props(s.stack)}>
                <Queue jobs={queue} onChanged={() => refreshAll(qc)} />
              </div>
            ) : null}
          </>
        ) : null}

        {tab === "scans" ? (
          <div {...stylex.props(s.stack)}>
            <Library
              scans={scans}
              total={scansTotal}
              max={scansMax}
              now={now}
              loading={scansQ.isLoading}
              onChanged={() => refreshAll(qc)}
              onPreview={setPreviewScan}
            />
          </div>
        ) : null}

        {tab === "history" ? (
          <div {...stylex.props(s.stack)}>
            <History items={history} />
          </div>
        ) : null}

        {tab === "settings" ? (
          <div {...stylex.props(s.stack)}>
            <SharingSettings
              displayName={displayName}
              printerName={printerName}
              sharing={networkSharing}
              host={host}
              onSaved={() => refreshAll(qc)}
            />
            <PrinterAddressSettings printerIp={printerIp} onSaved={() => refreshAll(qc)} />
          </div>
        ) : null}

        <div {...stylex.props(s.liveRow)}>
          <Clock size={12} />
          <span>
            Updated {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            {historyQ.isError ? " · retrying…" : ""}
          </span>
          <span {...stylex.props(s.refreshBtn)}>
            <button
              onClick={() => { refreshAll(qc); push({ kind: "info", title: "Refreshing" }); }}
              aria-label="Refresh all data"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8,
                border: `1px solid ${vars.line}`, background: "transparent",
                color: vars.textSecondary as string, fontSize: 12, cursor: "pointer",
              }}
            >
              <RefreshCw size={12} /> Refresh
            </button>
          </span>
        </div>

        <footer {...stylex.props(s.footer)}>
          <span>Print Room · {displayName} · {printerIp}</span>
          <span>Local network only</span>
        </footer>
      </main>

      {previewScan ? <PreviewModal scan={previewScan} onClose={() => setPreviewScan(null)} /> : null}
    </div>
  );
}
