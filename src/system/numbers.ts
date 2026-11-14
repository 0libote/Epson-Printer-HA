/** Shared numeric helpers: one copy for the web app, the history worker and tests. */
export function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function formatBytes(value: number): string {
  const bytes = Math.max(0, Math.trunc(value || 0));
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
