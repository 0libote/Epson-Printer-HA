import type { createCupsBackend } from "./cups.ts";
export type CupsBackend = ReturnType<typeof createCupsBackend>;
export type PrintJob = Awaited<ReturnType<CupsBackend["listJobs"]>>[number];
export type QueueStatus = Awaited<ReturnType<CupsBackend["getStatus"]>>;
