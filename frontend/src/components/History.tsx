import * as stylex from "@stylexjs/stylex";
import { vars } from "../styles/tokens.stylex";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { HistoryItem } from "../lib/api";
import { s as ui, Card, EmptyState, safeLabel } from "./ui";

const s = stylex.create({
  searchWrap: { position: "relative", flex: 1 },
  searchIcon: { position: "absolute", left: "11px", top: "50%", transform: "translateY(-50%)", opacity: 0.5, pointerEvents: "none" },
  tableWrap: { overflowX: "auto", margin: "0 -20px", padding: "0 20px" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "13px", minWidth: "560px" },
  th: {
    textAlign: "left",
    fontFamily: vars.fontSans,
    fontSize: "11px",
    fontWeight: 600,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: vars.textTertiary,
    padding: "8px 12px 8px 0",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: vars.line,
    whiteSpace: "nowrap",
  },
  td: {
    padding: "10px 12px 10px 0",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: vars.line,
    verticalAlign: "top",
  },
  doc: { fontFamily: vars.fontSans, fontSize: "13px", fontWeight: 550, color: vars.text, overflowWrap: "anywhere" },
  sub: { fontFamily: vars.fontMono, fontSize: "11px", color: vars.textTertiary, marginTop: "2px" },
  mono: { fontFamily: vars.fontMono, fontSize: "12px", color: vars.textSecondary, whiteSpace: "nowrap" },
  state: {
    display: "inline-block",
    padding: "3px 9px",
    borderRadius: vars.radiusFull,
    fontFamily: vars.fontSans,
    fontSize: "12px",
    fontWeight: 550,
    textTransform: "capitalize",
    whiteSpace: "nowrap",
  },
});

function stateTone(state: string): string | undefined {
  if (state === "completed") return vars.goodSoft as string;
  if (state === "pending" || state === "printing") return vars.warnSoft as string;
  if (state === "cancelled" || state === "aborted") return vars.badSoft as string;
  return vars.bgSunken as string;
}

function stateColor(state: string): string | undefined {
  if (state === "completed") return vars.good as string;
  if (state === "pending" || state === "printing") return vars.warn as string;
  if (state === "cancelled" || state === "aborted") return vars.bad as string;
  return vars.textSecondary as string;
}

const PAGE = 25;

export function History({ items }: { items: HistoryItem[] }) {
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState(false);

  const filtered = useMemo(() => {
    if (!filter.trim()) return items;
    const q = filter.toLowerCase();
    return items.filter((h) =>
      `${h.document} ${h.source} ${h.state} ${h.user_name || ""} ${h.origin_host || ""}`.toLowerCase().includes(q)
    );
  }, [items, filter]);

  const visible = expanded ? filtered : filtered.slice(0, PAGE);

  return (
    <Card>
      <div {...stylex.props(ui.sectionHead)}>
        <h2 {...stylex.props(ui.sectionTitle)}>Print history</h2>
        <span {...stylex.props(s.mono)}>{filtered.length} {filtered.length === 1 ? "job" : "jobs"}</span>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <div {...stylex.props(s.searchWrap)}>
          <Search size={14} {...stylex.props(s.searchIcon)} />
          <input
            {...stylex.props(ui.input)}
            style={{ paddingLeft: 32 }}
            placeholder="Search documents, users, status…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Search print history"
          />
        </div>
      </div>
      {visible.length === 0 ? (
        <EmptyState title="No print history" body={items.length === 0 ? "Printed documents will show up here." : "Try a different search."} />
      ) : (
        <>
          <div {...stylex.props(s.tableWrap)}>
            <table {...stylex.props(s.table)}>
              <thead>
                <tr>
                  <th {...stylex.props(s.th)}>Document</th>
                  <th {...stylex.props(s.th)}>When</th>
                  <th {...stylex.props(s.th)}>From</th>
                  <th {...stylex.props(s.th)}>Status</th>
                  <th {...stylex.props(s.th)}>Size</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((j) => (
                  <tr key={j.history_key || `${j.job_id}-${j.created_at}-${j.document}`}>
                    <td {...stylex.props(s.td)}>
                      <div {...stylex.props(s.doc)}>{j.document}</div>
                      <div {...stylex.props(s.sub)}>#{j.job_id}</div>
                    </td>
                    <td {...stylex.props(s.td)}><span {...stylex.props(s.mono)}>{j.created_display}</span></td>
                    <td {...stylex.props(s.td)} style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }}>
                      <span {...stylex.props(s.mono)}>{j.origin_host || j.user_name || j.source}</span>
                    </td>
                    <td {...stylex.props(s.td)}>
                      <span {...stylex.props(s.state)} style={{ backgroundColor: stateTone(j.state), color: stateColor(j.state) }}>
                        {safeLabel(j.state)}
                      </span>
                    </td>
                    <td {...stylex.props(s.td)}><span {...stylex.props(s.mono)}>{j.size_display}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p {...stylex.props(ui.help)} style={{ marginTop: 10 }}>File contents are never stored — metadata only.</p>
          {filtered.length > PAGE ? (
            <div style={{ marginTop: 10 }}>
              <button {...stylex.props(ui.buttonQuiet)} onClick={() => setExpanded((v) => !v)}>
                {expanded ? "Show less" : `Show all ${filtered.length}`}
              </button>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
