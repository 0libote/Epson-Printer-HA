export type WorkspaceView = "print" | "scan" | "scans" | "history" | "settings";

export function viewFromHash(hash: string): WorkspaceView | null {
  const value = hash.replace(/^#/, "");
  if (value === "overview" || value === "") return "print";
  return ["print", "scan", "scans", "history", "settings"].includes(value)
    ? (value as WorkspaceView)
    : null;
}
