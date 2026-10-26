import { useState } from "react";
import { FileText, Search } from "lucide-react";
import type { HistoryItem } from "../lib/api";
import { filterHistory, type HistoryFilter } from "../lib/history-filter";
import { Card, safeLabel } from "./ui";

const PAGE = 25;
function stateTone(state: string) {
  if (state === "completed") return "good";
  if (["pending", "held", "printing", "stopped"].includes(state)) return "warn";
  if (["cancelled", "aborted"].includes(state)) return "bad";
  return "neutral";
}
function dateParts(item: HistoryItem) {
  if (!item.created_at) return [item.created_display, ""];
  const date = new Date(item.created_at * 1000);
  return [
    date.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  ];
}

export function History({ items }: { items: HistoryItem[] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<HistoryFilter>("all");
  const [expanded, setExpanded] = useState(false);
  const filtered = filterHistory(items, search, status);
  const visible = expanded ? filtered : filtered.slice(0, PAGE);
  return (
    <Card className="history-panel">
      <div className="collection-toolbar">
        <div className="collection-search">
          <Search size={17} />
          <input
            className="control"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search documents, people or devices"
            aria-label="Search print history"
          />
        </div>
        <select
          className="control collection-select"
          value={status}
          onChange={(event) => setStatus(event.target.value as HistoryFilter)}
          aria-label="Filter history by status"
        >
          <option value="all">All statuses</option>
          <option value="completed">Completed</option>
          <option value="active">Printing & waiting</option>
          <option value="failed">Failed or cancelled</option>
          <option value="unknown">Unknown outcome</option>
        </select>
      </div>
      <div className="collection-summary">
        <span>
          {filtered.length} {filtered.length === 1 ? "job" : "jobs"}
          {search || status !== "all" ? " found" : " in your history"}
        </span>
      </div>
      {visible.length ? (
        <div className="history-table-wrap">
          <table className="history-table">
            <caption className="visually-hidden">
              Print jobs and their results
            </caption>
            <thead>
              <tr>
                <th scope="col">Document</th>
                <th scope="col">Date</th>
                <th scope="col">From</th>
                <th scope="col">Status</th>
                <th scope="col">Size</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const [date, time] = dateParts(item);
                return (
                  <tr
                    key={
                      item.history_key ||
                      `${item.job_id}-${item.created_at}-${item.document}`
                    }
                  >
                    <td className="history-document">
                      <span className="history-file-icon">
                        <FileText size={19} strokeWidth={1.5} />
                      </span>
                      <span>
                        <strong>{item.document}</strong>
                        <small>Job #{item.job_id}</small>
                      </span>
                    </td>
                    <td className="history-date" data-label="Date">
                      <span>{date}</span>
                      <small>{time}</small>
                    </td>
                    <td className="history-origin" data-label="From">
                      {item.origin_host || item.user_name || item.source}
                    </td>
                    <td className="history-state">
                      <span
                        className={`status-badge is-${stateTone(item.state)}`}
                      >
                        {item.state === "unknown"
                          ? "Outcome unknown"
                          : safeLabel(item.state)}
                      </span>
                    </td>
                    <td className="history-size" data-label="Size">
                      {item.size_display}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="collection-empty">
          <FileText size={30} strokeWidth={1.3} />
          <h2>{items.length ? "No matching jobs" : "No print jobs yet"}</h2>
          <p>
            {items.length
              ? "Try another search or choose a different status."
              : "Documents you print will appear here, including jobs sent from other devices."}
          </p>
          {!items.length ? (
            <a className="button-secondary" href="#print">
              Print your first document
            </a>
          ) : null}
        </div>
      )}
      <div className="collection-footer">
        <p>Only job details are kept. Document contents aren’t stored here.</p>
        {filtered.length > PAGE ? (
          <button
            className="button-secondary"
            onClick={() => setExpanded((previous) => !previous)}
          >
            {expanded ? "Show fewer" : `Show all ${filtered.length} jobs`}
          </button>
        ) : null}
      </div>
    </Card>
  );
}
