import { expect, test } from "bun:test";
import { viewFromHash } from "../../frontend/src/lib/navigation";
import { filterHistory } from "../../frontend/src/lib/history-filter";
import type { HistoryItem } from "../../frontend/src/lib/api";

test("each task has a direct destination and old links still work", () => {
  for (const view of ["print", "scan", "scans", "history", "settings"] as const)
    expect(viewFromHash(`#${view}`)).toBe(view);
  expect(viewFromHash("#overview")).toBe("print");
  expect(viewFromHash("")).toBe("print");
  expect(viewFromHash("#main-content")).toBeNull();
  expect(viewFromHash("#unknown")).toBeNull();
});

test("history search and status filters work together without hiding unknown outcomes", () => {
  const rows = [
    "completed",
    "printing",
    "held",
    "stopped",
    "cancelled",
    "aborted",
    "unknown",
    "state-99",
  ].map(
    (state, index) =>
      ({
        job_id: index,
        document: index % 2 ? "Letter.pdf" : "Receipt.pdf",
        state,
        source: "Home computer",
        created_at: 1000,
        created_display: "Today",
        size_display: "1 MB",
      }) satisfies HistoryItem,
  );
  expect(filterHistory(rows, "", "completed").map((row) => row.state)).toEqual([
    "completed",
  ]);
  expect(filterHistory(rows, "", "active").map((row) => row.state)).toEqual([
    "printing",
    "held",
    "stopped",
  ]);
  expect(filterHistory(rows, "", "failed").map((row) => row.state)).toEqual([
    "cancelled",
    "aborted",
  ]);
  expect(filterHistory(rows, "", "unknown").map((row) => row.state)).toEqual([
    "unknown",
    "state-99",
  ]);
  expect(
    filterHistory(rows, " LETTER ", "active").map((row) => row.state),
  ).toEqual(["printing", "stopped"]);
  expect(filterHistory(rows, "no match", "all")).toEqual([]);
  expect(rows).toHaveLength(8);
});
