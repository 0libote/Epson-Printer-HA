import * as stylex from "@stylexjs/stylex";
import { vars } from "../styles/tokens.stylex";
import { type ReactNode, useEffect, useState } from "react";
import {
  Check,
  Download,
  FileStack,
  ScanLine,
  Pencil,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { CombineScans } from "./CombineScans";
import { useToast } from "./Toast";
import {
  deleteScan,
  renameScan,
  type ScanItem,
  type ScanSort,
  type ScanStorage,
} from "../lib/api";
import { s as ui, Card, EmptyState } from "./ui";

const s = stylex.create({
  toolbar: {
    display: "flex",
    gap: "8px",
    marginBottom: "4px",
    flexWrap: "wrap",
  },
  searchWrap: { position: "relative", flex: "1 1 160px", minWidth: 0 },
  searchIcon: {
    position: "absolute",
    left: "11px",
    top: "50%",
    transform: "translateY(-50%)",
    opacity: 0.5,
    pointerEvents: "none",
  },
  searchInput: { paddingLeft: "32px" },
  sort: { width: "auto", flexShrink: 0 },
  list: { display: "flex", flexDirection: "column" },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "10px 4px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: vars.line,
    "@media (max-width: 600px)": {
      display: "grid",
      gridTemplateColumns: "20px 40px minmax(0, 1fr)",
      gap: "8px",
    },
  },
  thumb: {
    width: "52px",
    height: "52px",
    borderRadius: vars.radiusSm,
    overflow: "hidden",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.line,
    flexShrink: 0,
    backgroundColor: vars.bgSunken,
    display: "grid",
    placeItems: "center",
    textDecoration: "none",
    color: vars.textTertiary,
    "@media (max-width: 600px)": { width: "40px", height: "40px" },
  },
  thumbImg: { width: "100%", height: "100%", objectFit: "cover" },
  nameBtn: {
    minWidth: 0,
    flex: 1,
    textAlign: "left",
    borderWidth: 0,
    borderStyle: "none",
    padding: 0,
    backgroundColor: "transparent",
    color: "inherit",
    cursor: "pointer",
  },
  name: {
    fontFamily: vars.fontSans,
    fontSize: "13.5px",
    fontWeight: 550,
    display: "block",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  meta: {
    fontFamily: vars.fontMono,
    fontSize: "11px",
    color: vars.textTertiary,
    display: "flex",
    flexWrap: "wrap",
    gap: "4px",
    marginTop: "3px",
    alignItems: "center",
  },
  badge: {
    textTransform: "uppercase",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.line,
    borderRadius: "4px",
    padding: "0 4px",
    fontSize: "9.5px",
  },
  actions: {
    display: "flex",
    gap: "6px",
    flexShrink: 0,
    "@media (max-width: 600px)": {
      gridColumn: "2 / -1",
      justifyContent: "flex-end",
    },
  },
  iconBtn: {
    width: "30px",
    height: "30px",
    borderRadius: vars.radiusSm,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.line,
    backgroundColor: "transparent",
    color: vars.textSecondary,
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    "@media (max-width: 600px)": { width: "44px", height: "44px" },
  },
  iconBtnDanger: { color: vars.bad },
  renameRow: {
    minWidth: 0,
    flex: 1,
    display: "flex",
    gap: "6px",
    alignItems: "center",
    "@media (max-width: 600px)": { gridColumn: "1 / -1" },
  },
  renameInput: { minWidth: 0, flex: 1 },
  bulkBar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "10px",
    padding: "8px 4px",
    fontFamily: vars.fontSans,
    fontSize: "12.5px",
    color: vars.textSecondary,
  },
  count: {
    fontFamily: vars.fontMono,
    fontSize: "11.5px",
    color: vars.textTertiary,
  },
});

const FALLBACK_IMG =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='#8a8e96' stroke-width='1.5'><rect x='3' y='3' width='18' height='18' rx='2'/><circle cx='8.5' cy='8.5' r='1.5'/><path d='M21 15l-5-5L5 21'/></svg>`,
  );

function relTime(mtimeMs: number, now: number): string {
  const s = Math.floor((now - mtimeMs) / 1000);
  if (s < 45) return "just now";
  if (s < 90) return "a minute ago";
  if (s < 45 * 60) return `${Math.floor(s / 60)} min ago`;
  if (s < 90 * 60) return "an hour ago";
  if (s < 22 * 3600) return `${Math.floor(s / 3600)} hrs ago`;
  if (s < 36 * 3600) return "a day ago";
  if (s < 25 * 86400) return `${Math.floor(s / 86400)} days ago`;
  const d = new Date(mtimeMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function ScanRow({
  scan,
  now,
  selected,
  busy,
  onToggle,
  onPreview,
  onRemove,
  rename,
}: Readonly<{
  scan: ScanItem;
  now: number;
  selected: boolean;
  busy: boolean;
  onToggle: () => void;
  onPreview: () => void;
  onRemove: () => void;
  rename: Readonly<{
    active: boolean;
    value: string;
    onChange: (value: string) => void;
    start: () => void;
    confirm: () => void;
    cancel: () => void;
  }>;
}>) {
  return (
    <div {...stylex.props(s.row)}>
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle()}
        aria-label={`Select ${scan.name}`}
        style={{
          width: 16,
          height: 16,
          accentColor: vars.accent as string,
        }}
      />
      <button
        type="button"
        {...stylex.props(s.thumb)}
        onClick={() => onPreview()}
        aria-label={`Preview ${scan.name}`}
        title="Preview"
      >
        {scan.ext === ".pdf" ? (
          <span
            style={{
              fontFamily: vars.fontMono as string,
              fontSize: 10,
              fontWeight: 600,
              color: vars.bad as string,
            }}
          >
            PDF
          </span>
        ) : (
          <img
            src={`/api/scans/${encodeURIComponent(scan.name)}/thumb`}
            alt=""
            width={52}
            height={52}
            {...stylex.props(s.thumbImg)}
            loading="lazy"
            onError={(e) => {
              const img = e.target as HTMLImageElement;
              img.onerror = null;
              img.src = FALLBACK_IMG;
            }}
          />
        )}
      </button>
      {rename.active ? (
        <span {...stylex.props(s.renameRow)}>
          <input
            {...stylex.props(ui.input, s.renameInput)}
            value={rename.value}
            onChange={(e) => rename.onChange(e.target.value)}
            autoFocus
            placeholder={scan.name.replace(/\.[^.]+$/, "")}
            onKeyDown={(e) => {
              if (e.key === "Enter") rename.confirm();
              if (e.key === "Escape") {
                rename.cancel();
              }
            }}
            aria-label="New name"
          />
          <button
            {...stylex.props(s.iconBtn)}
            disabled={busy}
            onClick={() => rename.confirm()}
            aria-label="Confirm rename"
          >
            <Check size={14} />
          </button>
          <button
            {...stylex.props(s.iconBtn)}
            onClick={() => {
              rename.cancel();
            }}
            aria-label="Cancel rename"
          >
            <X size={14} />
          </button>
        </span>
      ) : (
        <button
          type="button"
          {...stylex.props(s.nameBtn)}
          onClick={() => onPreview()}
          title={scan.mtimeIso}
        >
          <span {...stylex.props(s.name)}>{scan.name}</span>
          <span {...stylex.props(s.meta)}>
            <span>{scan.sizeDisplay}</span>
            <span>·</span>
            <span title={scan.mtimeIso}>{relTime(scan.mtimeMs, now)}</span>
            <span>·</span>
            <span {...stylex.props(s.badge)}>{scan.ext.slice(1)}</span>
          </span>
        </button>
      )}
      <span {...stylex.props(s.actions)}>
        <a
          href={`/scans/${encodeURIComponent(scan.name)}`}
          {...stylex.props(s.iconBtn)}
          style={{ textDecoration: "none" }}
          title="Download"
          aria-label={`Download ${scan.name}`}
        >
          <Download size={14} />
        </a>
        <button
          {...stylex.props(s.iconBtn)}
          onClick={() => {
            rename.start();
          }}
          title="Rename"
          aria-label={`Rename ${scan.name}`}
        >
          <Pencil size={13} />
        </button>
        <button
          {...stylex.props(s.iconBtn, s.iconBtnDanger)}
          disabled={busy}
          onClick={() => onRemove()}
          title="Delete"
          aria-label={`Delete ${scan.name}`}
        >
          <Trash2 size={14} />
        </button>
      </span>
    </div>
  );
}

function StorageSummary({ storage }: Readonly<{ storage: ScanStorage }>) {
  return (
    <output className="storage-summary">
      <span className="storage-details">
        <strong>
          {storage.total} saved scans · Limit {storage.max}
        </strong>
        <span className="storage-policy">
          {storage.policy === "delete-oldest"
            ? "Automatic deletion is enabled for new scans."
            : "Your saved documents are kept until you delete them."}
        </span>
      </span>
      {storage.available_bytes >= 0 ? (
        <small>{formatStorage(storage.available_bytes)} free on hub</small>
      ) : null}
      {storage.full ? (
        <span className="storage-full-note">
          Download and delete unneeded files to make room. PDF assembly always
          keeps your originals.
        </span>
      ) : null}
    </output>
  );
}

function LibraryContents({
  loading,
  empty,
  total,
  children,
}: Readonly<{
  loading: boolean;
  empty: boolean;
  total: number;
  children: ReactNode;
}>) {
  if (loading)
    return (
      <div style={{ display: "grid", gap: 8, padding: "12px 0" }}>
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            {...stylex.props(ui.skeleton)}
            style={{ height: 60 }}
          />
        ))}
      </div>
    );
  if (empty)
    return (
      <EmptyState
        title={total === 0 ? "No scans yet" : "No matches"}
        body={
          total === 0
            ? "Your scans will appear here once you scan something."
            : "Try a different filter."
        }
      />
    );
  return children;
}

export function Library({
  scans,
  total,
  max,
  storage,
  now,
  loading,
  onChanged,
  onPreview,
  filter,
  onFilter,
  sort,
  onSort,
  matched,
  hasMore,
  loadingMore,
  searching,
  onLoadMore,
}: Readonly<{
  scans: ScanItem[];
  total: number;
  max: number;
  storage?: ScanStorage;
  filter: string;
  onFilter: (value: string) => void;
  sort: ScanSort;
  onSort: (value: ScanSort) => void;
  matched: number;
  hasMore: boolean;
  loadingMore: boolean;
  searching: boolean;
  onLoadMore: () => void;
  now: number;
  loading: boolean;
  onChanged: () => void;
  onPreview: (scan: ScanItem) => void;
}>) {
  const { push } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [combineFiles, setCombineFiles] = useState<string[] | null>(null);
  useEffect(() => {
    setSelected(
      (previous) =>
        new Set(
          [...previous].filter((name) =>
            scans.some((scan) => scan.name === name),
          ),
        ),
    );
  }, [scans]);

  const visible = scans;

  const toggle = (name: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });
  };

  const remove = async (name: string) => {
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    if (busy) return;
    setBusy(true);
    try {
      await deleteScan(name);
      push({ kind: "success", title: "Deleted", desc: name });
      setSelected((prev) => {
        const n = new Set(prev);
        n.delete(name);
        return n;
      });
      onChanged();
    } catch (err: any) {
      push({
        kind: "error",
        title: "Couldn't delete",
        desc: String(err.message || err).slice(0, 220),
      });
    } finally {
      setBusy(false);
    }
  };

  const bulkDelete = async () => {
    if (selected.size === 0 || busy) return;
    if (!confirm(`Delete ${selected.size} scans?`)) return;
    setBusy(true);
    const names = [...selected];
    const results = await Promise.allSettled(names.map((n) => deleteScan(n)));
    setBusy(false);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const fail = results.length - ok;
    push({
      kind: fail ? "error" : "success",
      title: fail ? `Deleted ${ok}, ${fail} failed` : `Deleted ${ok} scans`,
    });
    setSelected(
      new Set(names.filter((_, i) => results[i].status === "rejected")),
    );
    onChanged();
  };

  const doRename = async (oldName: string) => {
    const base = oldName.replace(/\.[^.]+$/, "");
    const v = renameValue.trim() || base;
    if (!v) return;
    if (busy) return;
    setBusy(true);
    try {
      const res = await renameScan(oldName, v);
      push({
        kind: "success",
        title: "Renamed",
        desc: `${oldName} → ${res.name || v}`,
      });
      setRenaming(null);
      setRenameValue("");
      onChanged();
    } catch (err: any) {
      push({
        kind: "error",
        title: "Rename failed",
        desc: String(err.message || err).slice(0, 220),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="library-intro">
        <span>YOUR PAPER, DIGITISED</span>
        <p>
          Keep a single page, or select several scans to bring them together in
          one PDF.
        </p>
        <a href="#scan">
          Scan a new page <ScanLine size={14} />
        </a>
      </div>
      <Card>
        <div {...stylex.props(ui.sectionHead)}>
          <h2 {...stylex.props(ui.sectionTitle)}>Scans</h2>
          <span {...stylex.props(s.count)}>
            {total}/{max}
          </span>
        </div>

        {storage ? <StorageSummary storage={storage} /> : null}
        {searching ? (
          <output className="section-loading">Searching saved scans…</output>
        ) : null}
        <div {...stylex.props(s.toolbar)}>
          <div {...stylex.props(s.searchWrap)}>
            <Search size={14} {...stylex.props(s.searchIcon)} />
            <input
              {...stylex.props(ui.input, s.searchInput)}
              placeholder="Filter by name…"
              value={filter}
              onChange={(e) => onFilter(e.target.value)}
              aria-label="Filter scans by name"
            />
          </div>
          <select
            {...stylex.props(ui.select, s.sort)}
            value={sort}
            onChange={(e) => onSort(e.target.value as ScanSort)}
            aria-label="Sort scans"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="name">Name</option>
            <option value="size">Size</option>
          </select>
        </div>

        {selected.size > 0 ? (
          <div {...stylex.props(s.bulkBar)}>
            <span>{selected.size} selected</span>
            <button
              {...stylex.props(ui.buttonQuiet)}
              disabled={busy || selected.size < 2 || selected.size > 50}
              onClick={() =>
                setCombineFiles(
                  scans
                    .filter((scan) => selected.has(scan.name))
                    .map((scan) => scan.name),
                )
              }
            >
              <FileStack size={14} /> Combine into PDF
            </button>
            <button
              {...stylex.props(ui.buttonQuiet, ui.buttonDanger)}
              disabled={busy}
              onClick={bulkDelete}
            >
              <Trash2 size={13} /> Delete selected
            </button>
            <button
              {...stylex.props(ui.buttonQuiet)}
              onClick={() => setSelected(new Set())}
            >
              Clear
            </button>
          </div>
        ) : null}

        <LibraryContents
          loading={loading}
          empty={visible.length === 0}
          total={total}
        >
          <div {...stylex.props(s.list)}>
            {visible.map((scan) => (
              <ScanRow
                key={scan.name}
                scan={scan}
                now={now}
                selected={selected.has(scan.name)}
                busy={busy}
                onToggle={() => toggle(scan.name)}
                onPreview={() => onPreview(scan)}
                onRemove={() => remove(scan.name)}
                rename={{
                  active: renaming === scan.name,
                  value: renameValue,
                  onChange: setRenameValue,
                  start: () => {
                    setRenaming(scan.name);
                    setRenameValue(scan.name.replace(/\.[^.]+$/, ""));
                  },
                  confirm: () => doRename(scan.name),
                  cancel: () => {
                    setRenaming(null);
                    setRenameValue("");
                  },
                }}
              />
            ))}
          </div>
        </LibraryContents>
        {hasMore ? (
          <div className="load-more-scans">
            <p>
              Showing {scans.length} of {matched}{" "}
              {filter ? "matching scans" : "scans"}
            </p>
            <button
              {...stylex.props(ui.buttonQuiet)}
              disabled={loadingMore}
              onClick={onLoadMore}
            >
              {loadingMore ? "Loading…" : "Load more scans"}
            </button>
          </div>
        ) : null}
      </Card>
      {combineFiles ? (
        <CombineScans
          files={combineFiles}
          onClose={() => setCombineFiles(null)}
          onCreated={() => {
            setSelected(new Set());
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

function formatStorage(bytes: number) {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${Math.floor(bytes / 1024 ** 2)} MB`;
}
