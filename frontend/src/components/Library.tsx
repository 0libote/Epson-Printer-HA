import * as stylex from "@stylexjs/stylex";
import { vars } from "../styles/tokens.stylex";
import { useMemo, useState } from "react";
import { Check, Download, Pencil, Search, Trash2, X } from "lucide-react";
import { useToast } from "./Toast";
import { deleteScan, renameScan, type ScanItem } from "../lib/api";
import { s as ui, Card, EmptyState } from "./ui";

const s = stylex.create({
  toolbar: { display: "flex", gap: "8px", marginBottom: "4px", flexWrap: "wrap" },
  searchWrap: { position: "relative", flex: "1 1 200px" },
  searchIcon: { position: "absolute", left: "11px", top: "50%", transform: "translateY(-50%)", opacity: 0.5, pointerEvents: "none" },
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
  name: { fontFamily: vars.fontSans, fontSize: "13.5px", fontWeight: 550, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  meta: { fontFamily: vars.fontMono, fontSize: "11px", color: vars.textTertiary, display: "flex", gap: "6px", marginTop: "3px", alignItems: "center" },
  badge: {
    textTransform: "uppercase",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: vars.line,
    borderRadius: "4px",
    padding: "0 4px",
    fontSize: "9.5px",
  },
  actions: { display: "flex", gap: "6px", flexShrink: 0 },
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
  },
  iconBtnDanger: { color: vars.bad },
  renameRow: { minWidth: 0, flex: 1, display: "flex", gap: "6px", alignItems: "center" },
  bulkBar: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "8px 4px",
    fontFamily: vars.fontSans,
    fontSize: "12.5px",
    color: vars.textSecondary,
  },
  count: { fontFamily: vars.fontMono, fontSize: "11.5px", color: vars.textTertiary },
});

const FALLBACK_IMG =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='#8a8e96' stroke-width='1.5'><rect x='3' y='3' width='18' height='18' rx='2'/><circle cx='8.5' cy='8.5' r='1.5'/><path d='M21 15l-5-5L5 21'/></svg>`
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

export function Library({ scans, total, max, now, loading, onChanged, onPreview }: {
  scans: ScanItem[];
  total: number;
  max: number;
  now: number;
  loading: boolean;
  onChanged: () => void;
  onPreview: (scan: ScanItem) => void;
}) {
  const { push } = useToast();
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "name" | "size">("newest");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const visible = useMemo(() => {
    let out = scans;
    if (filter.trim()) {
      const q = filter.toLowerCase();
      out = out.filter((x) => x.name.toLowerCase().includes(q));
    }
    const sorted = [...out];
    if (sort === "newest") sorted.sort((a, b) => b.mtimeMs - a.mtimeMs);
    else if (sort === "oldest") sorted.sort((a, b) => a.mtimeMs - b.mtimeMs);
    else if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else sorted.sort((a, b) => b.size - a.size);
    return sorted;
  }, [scans, filter, sort]);

  const toggle = (name: string) => {
    setSelected((prev) => { const n = new Set(prev); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  };

  const remove = async (name: string) => {
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    try {
      await deleteScan(name);
      push({ kind: "success", title: "Deleted", desc: name });
      setSelected((prev) => { const n = new Set(prev); n.delete(name); return n; });
      onChanged();
    } catch (err: any) {
      push({ kind: "error", title: "Couldn't delete", desc: String(err.message || err).slice(0, 220) });
    }
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} scans?`)) return;
    const results = await Promise.allSettled([...selected].map((n) => deleteScan(n)));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const fail = results.length - ok;
    push({ kind: fail ? "error" : "success", title: fail ? `Deleted ${ok}, ${fail} failed` : `Deleted ${ok} scans` });
    setSelected(new Set());
    onChanged();
  };

  const doRename = async (oldName: string) => {
    const base = oldName.replace(/\.[^.]+$/, "");
    const v = renameValue.trim() || base;
    if (!v) return;
    try {
      const res = await renameScan(oldName, v);
      push({ kind: "success", title: "Renamed", desc: `${oldName} → ${res.name || v}` });
      setRenaming(null);
      setRenameValue("");
      onChanged();
    } catch (err: any) {
      push({ kind: "error", title: "Rename failed", desc: String(err.message || err).slice(0, 220) });
    }
  };

  return (
    <Card>
      <div {...stylex.props(ui.sectionHead)}>
        <h2 {...stylex.props(ui.sectionTitle)}>Scans</h2>
        <span {...stylex.props(s.count)}>{total}/{max}</span>
      </div>

      <div {...stylex.props(s.toolbar)}>
        <div {...stylex.props(s.searchWrap)}>
          <Search size={14} {...stylex.props(s.searchIcon)} />
          <input
            {...stylex.props(ui.input, s.searchInput)}
            placeholder="Filter by name…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter scans by name"
          />
        </div>
        <select {...stylex.props(ui.select, s.sort)} value={sort} onChange={(e) => setSort(e.target.value as any)} aria-label="Sort scans">
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="name">Name</option>
          <option value="size">Size</option>
        </select>
      </div>

      {selected.size > 0 ? (
        <div {...stylex.props(s.bulkBar)}>
          <span>{selected.size} selected</span>
          <button {...stylex.props(ui.buttonQuiet, ui.buttonDanger)} onClick={bulkDelete}>
            <Trash2 size={13} /> Delete selected
          </button>
          <button {...stylex.props(ui.buttonQuiet)} onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      ) : null}

      {loading ? (
        <div style={{ display: "grid", gap: 8, padding: "12px 0" }}>
          {[0, 1, 2].map((i) => <div key={i} {...stylex.props(ui.skeleton)} style={{ height: 60 }} />)}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          title={scans.length === 0 ? "No scans yet" : "No matches"}
          body={scans.length === 0 ? "Your scans will appear here once you scan something." : "Try a different filter."}
        />
      ) : (
        <div {...stylex.props(s.list)}>
          {visible.map((scan) => (
            <div key={scan.name} {...stylex.props(s.row)}>
              <input
                type="checkbox"
                checked={selected.has(scan.name)}
                onChange={() => toggle(scan.name)}
                aria-label={`Select ${scan.name}`}
                style={{ width: 16, height: 16, accentColor: vars.accent as string }}
              />
              <button
                type="button"
                {...stylex.props(s.thumb)}
                onClick={() => onPreview(scan)}
                aria-label={`Preview ${scan.name}`}
                title="Preview"
              >
                {scan.ext === ".pdf" ? (
                  <span style={{ fontFamily: vars.fontMono as string, fontSize: 10, fontWeight: 600, color: vars.bad as string }}>PDF</span>
                ) : (
                  <img
                    src={`/api/scans/${encodeURIComponent(scan.name)}/thumb`}
                    alt=""
                    width={52}
                    height={52}
                    {...stylex.props(s.thumbImg)}
                    loading="lazy"
                    onError={(e) => { const img = e.target as HTMLImageElement; img.onerror = null; img.src = FALLBACK_IMG; }}
                  />
                )}
              </button>
              {renaming === scan.name ? (
                <span {...stylex.props(s.renameRow)}>
                  <input
                    {...stylex.props(ui.input)}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    autoFocus
                    placeholder={scan.name.replace(/\.[^.]+$/, "")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") doRename(scan.name);
                      if (e.key === "Escape") { setRenaming(null); setRenameValue(""); }
                    }}
                    aria-label="New name"
                  />
                  <button {...stylex.props(s.iconBtn)} onClick={() => doRename(scan.name)} aria-label="Confirm rename"><Check size={14} /></button>
                  <button {...stylex.props(s.iconBtn)} onClick={() => { setRenaming(null); setRenameValue(""); }} aria-label="Cancel rename"><X size={14} /></button>
                </span>
              ) : (
                <button type="button" {...stylex.props(s.nameBtn)} onClick={() => onPreview(scan)} title={scan.mtimeIso}>
                  <span {...stylex.props(s.name)}>{scan.name}</span>
                  <span {...stylex.props(s.meta)}>
                    <span>{scan.sizeDisplay}</span><span>·</span>
                    <span title={scan.mtimeIso}>{relTime(scan.mtimeMs, now)}</span><span>·</span>
                    <span {...stylex.props(s.badge)}>{scan.ext.slice(1)}</span>
                  </span>
                </button>
              )}
              <span {...stylex.props(s.actions)}>
                <a href={`/scans/${encodeURIComponent(scan.name)}`} {...stylex.props(s.iconBtn)} style={{ textDecoration: "none" }} title="Download" aria-label={`Download ${scan.name}`}>
                  <Download size={14} />
                </a>
                <button
                  {...stylex.props(s.iconBtn)}
                  onClick={() => { setRenaming(scan.name); setRenameValue(scan.name.replace(/\.[^.]+$/, "")); }}
                  title="Rename"
                  aria-label={`Rename ${scan.name}`}
                >
                  <Pencil size={13} />
                </button>
                <button {...stylex.props(s.iconBtn, s.iconBtnDanger)} onClick={() => remove(scan.name)} title="Delete" aria-label={`Delete ${scan.name}`}>
                  <Trash2 size={14} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
