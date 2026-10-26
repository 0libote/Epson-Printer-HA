import type { HistoryItem } from "./api";
export type HistoryFilter =
  | "all"
  | "completed"
  | "active"
  | "failed"
  | "unknown";
const active = new Set(["pending", "held", "printing", "stopped"]);
const failed = new Set(["cancelled", "aborted"]);
export function filterHistory(
  items: HistoryItem[],
  search: string,
  status: HistoryFilter,
) {
  const query = search.trim().toLowerCase();
  return items.filter((item) => {
    const matches =
      status === "all" ||
      (status === "completed" && item.state === "completed") ||
      (status === "active" && active.has(item.state)) ||
      (status === "failed" && failed.has(item.state)) ||
      (status === "unknown" &&
        item.state !== "completed" &&
        !active.has(item.state) &&
        !failed.has(item.state));
    return (
      matches &&
      `${item.document} ${item.source} ${item.state} ${item.user_name || ""} ${item.origin_host || ""}`
        .toLowerCase()
        .includes(query)
    );
  });
}
