import { lazy, Suspense, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Clock3,
  FileText,
  FolderOpen,
  Printer,
  RefreshCw,
  ScanLine,
  ShieldAlert,
} from "lucide-react";
import { Header } from "./components/Header";
import { WorkspaceNavigation } from "./components/WorkspaceNavigation";
import { SectionBoundary } from "./components/SectionBoundary";
import { PrintCard } from "./components/PrintCard";
import { ScanCard } from "./components/ScanCard";
import {
  Queue,
  QueueAttention,
  PrinterUnreachableBanner,
} from "./components/Overview";
import { InkLevels } from "./components/InkLevels";
import {
  SharingSettings,
  PrinterAddressSettings,
  AdvancedDiagnostics,
} from "./components/Settings";
import { Maintenance } from "./components/Maintenance";
import { useToast } from "./components/Toast";
import { useStatus, useHistory, useScans } from "./hooks/useStatus";
import { refreshStatus, type ScanItem, type ScanSort } from "./lib/api";
import { viewFromHash } from "./lib/navigation";

const Library = lazy(() =>
  import("./components/Library").then((m) => ({ default: m.Library })),
);
const History = lazy(() =>
  import("./components/History").then((m) => ({ default: m.History })),
);
const PreviewModal = lazy(() =>
  import("./components/PreviewModal").then((m) => ({
    default: m.PreviewModal,
  })),
);
const pages = {
  print: {
    title: "Print a document",
    description: "Print PDFs, photos and text files from this device.",
  },
  scan: {
    title: "Scan a page",
    description: "Save a paper document or photo as a PDF or image.",
  },
  scans: {
    title: "Saved scans",
    description: "Preview, download and combine the pages saved on this hub.",
  },
  history: {
    title: "Print history",
    description: "See what was sent to your printer and how it finished.",
  },
  settings: {
    title: "Settings",
    description:
      "Manage your printer and connect the other devices in your home.",
  },
};
function SectionLoading() {
  return <output className="section-loading">Loading…</output>;
}

function refreshAll(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all(
    ["status", "history", "scans", "ink"].map((key) =>
      qc.invalidateQueries({ queryKey: [key] }),
    ),
  );
}

function EmptyQueue({
  failed,
  checking,
}: {
  failed: boolean;
  checking: boolean;
}) {
  return (
    <div className="queue-empty">
      <span className="empty-queue-mark">
        <Printer size={23} strokeWidth={1.5} />
      </span>
      <strong>
        {failed
          ? "Queue unavailable"
          : checking
            ? "Checking the queue…"
            : "Nothing waiting to print"}
      </strong>
      <p>
        {failed
          ? "Refresh to try again. Your waiting jobs are kept."
          : checking
            ? "Your print jobs will appear here."
            : "Your next document will appear here when you send it."}
      </p>
    </div>
  );
}

export default function App() {
  const { data, isLoading, isError, error, refetch, dataUpdatedAt } =
    useStatus();
  const qc = useQueryClient();
  const { push } = useToast();
  const [view, setView] = useState(
    () => viewFromHash(window.location.hash) ?? "print",
  );
  useEffect(() => {
    const update = () => {
      const next = viewFromHash(window.location.hash);
      if (next) setView(next);
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  useEffect(() => {
    document.title = `${pages[view].title} · Print Room`;
    window.scrollTo(0, 0);
  }, [view]);

  const printerIp = data?.printer_ip || "";
  const displayName = data?.display_name || "Epson printer";
  const parts = data?.status_meta?.parts;
  const reachChecked = !!data && (!parts || !!parts.reachable?.updated_at);
  const statusStale = !!parts?.reachable?.stale || isError;
  const reachable = !!data?.reachable;
  const queue = data?.queue || [];
  const scanner = data?.scanner;
  const [refreshing, setRefreshing] = useState(false);
  const [previewScan, setPreviewScan] = useState<ScanItem | null>(null);
  useEffect(() => setPreviewScan(null), [view]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const historyQ = useHistory(100, view === "history");
  const [scanFilter, setScanFilter] = useState("");
  const [scanSort, setScanSort] = useState<ScanSort>("newest");
  const scansQ = useScans(
    100,
    !!printerIp && view === "scans",
    scanFilter,
    scanSort,
  );
  const scans = scansQ.data?.scans || [];
  const change = () => refreshAll(qc);
  const refresh = async () => {
    setRefreshing(true);
    try {
      qc.setQueryData(["status"], await refreshStatus());
      await change();
    } catch {
      push({
        kind: "error",
        title: "Could not refresh",
        desc: "Showing the last known status. Try again shortly.",
      });
    } finally {
      setRefreshing(false);
    }
  };
  const configured = !!printerIp;
  const workspace = view === "print" || view === "scan";
  const queueChecking =
    !!parts && (!parts.queue?.updated_at || parts.queue.stale);
  const scannerChecking =
    !!parts && (!parts.scanner?.updated_at || parts.scanner.stale);

  return (
    <div className={`app-shell ${!configured ? "is-setup" : ""}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {configured ? (
        <WorkspaceNavigation
          view={view}
          displayName={displayName}
          printerIp={printerIp}
          queueCount={queue.length}
          build={data?.build_number}
        />
      ) : null}
      <div className="app-body">
        <Header
          online={reachable}
          checking={!reachChecked}
          stale={statusStale}
          setupNeeded={!!data && !configured}
        >
          {configured ? (
            <button
              className="icon-button refresh-button"
              type="button"
              onClick={refresh}
              disabled={refreshing}
              aria-label="Refresh status"
              title="Refresh status"
            >
              <RefreshCw
                size={17}
                className={refreshing ? "spin" : undefined}
              />
            </button>
          ) : null}
        </Header>
        <main className="app-main" id="main-content" tabIndex={-1}>
          {isLoading ? (
            <div className="opening-state">
              <div className="opening-mark">
                <Printer size={25} />
              </div>
              <h1>Connecting to your printer</h1>
              <p>Loading your workspace…</p>
              <div className="loading-placeholder opening-skeleton" />
            </div>
          ) : null}
          {isError && !data ? (
            <section className="error-state" role="alert">
              <ShieldAlert size={30} />
              <h1>Can’t reach your print hub</h1>
              <p>{error?.message || "Check your connection and try again."}</p>
              <button
                className="button-solid"
                type="button"
                onClick={() => refetch()}
              >
                <RefreshCw size={16} /> Try again
              </button>
            </section>
          ) : null}
          {data && !configured ? (
            <div className="setup-page">
              <div className="page-heading">
                <span className="setup-symbol">
                  <Printer size={28} />
                </span>
                <h1>Let’s connect your printer</h1>
                <p>
                  Turn on your Epson and connect it to the same network as this
                  hub. You only need to do this once.
                </p>
              </div>
              <PrinterAddressSettings
                printerIp=""
                recovery={data.recovery}
                onSaved={change}
              />
            </div>
          ) : null}
          {configured ? (
            <>
              <div className="page-heading">
                <div>
                  <h1>{pages[view].title}</h1>
                  <p>{pages[view].description}</p>
                </div>
                {view === "scans" ? (
                  <a className="button-solid" href="#scan">
                    <ScanLine size={17} /> New scan
                  </a>
                ) : null}
                {view === "history" ? (
                  <a className="button-secondary" href="#print">
                    <Printer size={16} /> Print a document
                  </a>
                ) : null}
              </div>
              {isError ? (
                <div className="connection-notice" role="status">
                  <ShieldAlert size={18} />
                  <div>
                    <strong>The hub connection was interrupted</strong>
                    <p>
                      Showing the last known information. Refresh to reconnect.
                    </p>
                  </div>
                </div>
              ) : null}
              {workspace && data?.printer.state === "disabled" ? (
                <QueueAttention onChanged={change} />
              ) : null}
              {workspace && reachChecked && !reachable && !statusStale ? (
                <PrinterUnreachableBanner
                  recoveryMessage={data?.recovery?.message}
                  network={data?.printer_network ?? null}
                  queuedJobs={queue.length}
                />
              ) : null}
              <div className="task-layout" hidden={!workspace}>
                <div className="task-main">
                  <section
                    hidden={view !== "print"}
                    aria-label="Print a document"
                  >
                    <PrintCard
                      onPrinted={change}
                      maxMb={data?.max_upload_mb}
                      offline={reachChecked && !statusStale && !reachable}
                    />
                  </section>
                  <section hidden={view !== "scan"} aria-label="Scan a page">
                    <ScanCard
                      scannerOk={!!scanner?.ok}
                      scannerDetail={scanner?.detail}
                      capabilities={scanner?.capabilities}
                      storage={data?.scan_storage}
                      onScanned={change}
                    />
                  </section>
                </div>
                <aside
                  className="workspace-context"
                  aria-label="Printer information"
                >
                  <section className="device-status-panel">
                    <div className="context-heading">
                      <h2>Your printer</h2>
                      <a
                        href="#settings"
                        className="icon-button"
                        aria-label="Printer settings"
                        title="Printer settings"
                      >
                        <ArrowUpRight size={17} />
                      </a>
                    </div>
                    <div className="device-status-row">
                      <Printer size={16} />
                      <span>Printing</span>
                      <strong
                        className={
                          reachable && data?.printer.ok && !statusStale
                            ? "text-good"
                            : ""
                        }
                      >
                        {!reachChecked
                          ? "Checking"
                          : statusStale
                            ? "Last known"
                            : !reachable
                              ? "Offline"
                              : data?.printer.state === "disabled"
                                ? "Paused"
                                : data?.printer.state === "printing"
                                  ? "Printing"
                                  : data?.printer.ok
                                    ? "Ready"
                                    : "Needs attention"}
                      </strong>
                    </div>
                    <div className="device-status-row">
                      <ScanLine size={16} />
                      <span>Scanner</span>
                      <strong
                        className={
                          scanner?.ok && !scannerChecking ? "text-good" : ""
                        }
                      >
                        {scannerChecking
                          ? "Checking"
                          : scanner?.state === "scanning"
                            ? "Scanning"
                            : scanner?.ok
                              ? "Ready"
                              : "Unavailable"}
                      </strong>
                    </div>
                    <InkLevels
                      key={printerIp}
                      initial={data?.ink}
                      stale={parts?.ink?.stale}
                    />
                  </section>
                  <section
                    className="queue-panel"
                    hidden={view !== "print"}
                    aria-label="Print queue"
                  >
                    <div className="context-heading">
                      <h2>Print queue</h2>
                      <span className="count-badge">
                        {queueChecking ? "…" : queue.length}
                      </span>
                    </div>
                    {queue.length ? (
                      <Queue jobs={queue} onChanged={change} />
                    ) : (
                      <EmptyQueue
                        failed={!!parts?.queue?.error}
                        checking={queueChecking}
                      />
                    )}
                    <a className="context-link" href="#history">
                      <Clock3 size={15} /> View print history
                      <ArrowUpRight size={15} />
                    </a>
                  </section>
                  <section
                    className="scan-destination"
                    hidden={view !== "scan"}
                  >
                    <span className="destination-icon">
                      <FolderOpen size={21} strokeWidth={1.6} />
                    </span>
                    <h2>Everything in one place</h2>
                    <p>
                      Finished scans are saved on your hub. Download a single
                      page, or combine several into one PDF.
                    </p>
                    <a className="context-link" href="#scans">
                      Open saved scans
                      <ArrowUpRight size={15} />
                    </a>
                    {data?.scan_storage ? (
                      <div className="capacity-meter">
                        <span>
                          <strong>{data.scan_storage.total}</strong> of{" "}
                          {data.scan_storage.max} scans saved
                        </span>
                        <meter
                          min={0}
                          max={data.scan_storage.max}
                          value={data.scan_storage.total}
                          aria-label="Saved scan capacity"
                        />
                      </div>
                    ) : null}
                  </section>
                </aside>
              </div>
              {view === "scans" ? (
                <SectionBoundary>
                  <Suspense fallback={<SectionLoading />}>
                    {scansQ.isError ? (
                      <div className="inline-error" role="alert">
                        <p>Couldn’t load saved scans. {scansQ.error.message}</p>
                        <button
                          className="button-secondary"
                          onClick={() => scansQ.refetch()}
                        >
                          Try again
                        </button>
                      </div>
                    ) : null}
                    {!scansQ.isError || scansQ.data ? (
                      <Library
                        scans={scans}
                        total={scansQ.data?.total ?? scans.length}
                        max={scansQ.data?.max ?? 100}
                        storage={scansQ.data?.storage}
                        filter={scanFilter}
                        onFilter={setScanFilter}
                        sort={scanSort}
                        onSort={setScanSort}
                        matched={scansQ.data?.matched ?? scans.length}
                        hasMore={scansQ.hasNextPage}
                        loadingMore={scansQ.isFetchingNextPage}
                        searching={scansQ.isSearching}
                        onLoadMore={() => scansQ.fetchNextPage()}
                        now={now}
                        loading={scansQ.isLoading}
                        onChanged={change}
                        onPreview={setPreviewScan}
                      />
                    ) : null}
                  </Suspense>
                </SectionBoundary>
              ) : null}
              {view === "history" ? (
                <SectionBoundary>
                  <Suspense fallback={<SectionLoading />}>
                    {historyQ.isError ? (
                      <div className="inline-error" role="alert">
                        <p>
                          Couldn’t load print history. {historyQ.error.message}
                        </p>
                        <button
                          className="button-secondary"
                          onClick={() => historyQ.refetch()}
                        >
                          Try again
                        </button>
                      </div>
                    ) : null}
                    {historyQ.isLoading ? (
                      <SectionLoading />
                    ) : historyQ.data ? (
                      <History items={historyQ.data.history} />
                    ) : null}
                  </Suspense>
                </SectionBoundary>
              ) : null}
              {view === "settings" ? (
                <div className="settings-grid">
                  <div className="settings-connection">
                    <PrinterAddressSettings
                      printerIp={printerIp}
                      recovery={data?.recovery}
                      onSaved={change}
                    />
                    <div className="settings-support">
                      <FileText size={18} />
                      <div>
                        <strong>Everything stays at home</strong>
                        <p>
                          Your files and printer are managed on this hub.
                          There’s no cloud account to set up.
                        </p>
                      </div>
                    </div>
                  </div>
                  <SharingSettings
                    displayName={displayName}
                    printerName={data?.printer_name || "Home_Epson_XP2200"}
                    sharing={!!data?.network_sharing}
                    host={data?.client_setup?.host || window.location.hostname}
                    onSaved={change}
                  />
                  <div className="settings-advanced">
                    <Maintenance
                      capabilities={data?.printer_capabilities}
                      onChanged={change}
                    />
                    <AdvancedDiagnostics onChanged={change} />
                  </div>
                </div>
              ) : null}
              <footer className="workspace-footer">
                <span>
                  <span className="local-dot" /> Your files stay on your home
                  network
                </span>
                <span>
                  {isError
                    ? "Connection interrupted"
                    : `Status updated ${new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                  {refreshing ? " · Refreshing…" : ""}
                </span>
              </footer>
            </>
          ) : null}
        </main>
      </div>
      {previewScan ? (
        <SectionBoundary>
          <Suspense fallback={<SectionLoading />}>
            <PreviewModal
              scan={previewScan}
              onClose={() => setPreviewScan(null)}
            />
          </Suspense>
        </SectionBoundary>
      ) : null}
    </div>
  );
}
