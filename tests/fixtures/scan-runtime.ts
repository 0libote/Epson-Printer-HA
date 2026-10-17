// Isolated test server: real app/API/conversion with a controllable scanner.
// Never imported or copied into the appliance image.
import { appendFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const originalSpawn = Bun.spawn;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=",
  "base64",
);
let finish: (() => void) | null = null;
let ignoreKill = false;
Bun.spawn = ((args: string[], options: any) => {
  if (args[0] !== "scanimage") return originalSpawn(args, options);
  const stream = (value: string | Uint8Array) =>
    new Blob([value as BlobPart]).stream();
  if (args.includes("-L"))
    return {
      stdout: stream(
        "device 'epsonds:net:192.0.2.90' is an Epson test scanner\n",
      ),
      stderr: stream(""),
      exited: Promise.resolve(0),
    };
  if (args.includes("--help"))
    return {
      stdout: stream(
        "--mode Color|Gray|Lineart\n--resolution 75..600dpi\n--source Flatbed\n-x 0..215.9mm\n-y 0..297.18mm\n",
      ),
      stderr: stream(""),
      exited: Promise.resolve(0),
    };
  appendFileSync(join(process.env.APP_DATA!, "acquisitions.log"), "acquired\n");
  let resolve!: (code: number) => void;
  const scannerProcess = {
    stdout: stream(png),
    stderr: stream(""),
    exitCode: null as number | null,
    exited: new Promise<number>((done) => {
      resolve = done;
    }),
    kill() {
      if (!ignoreKill) {
        this.exitCode = 130;
        resolve(130);
      }
    },
  };
  finish = () => {
    scannerProcess.exitCode = 0;
    resolve(0);
  };
  return scannerProcess;
}) as typeof Bun.spawn;
const { app, shutdownScans, _getScanJobsForTest, SCAN_JOB_STALE_MS } =
  await import("../../src/app.ts");
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.SCAN_TEST_PORT || 0),
  fetch: (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/__fixture/fail-save") {
      renameSync(
        join(process.env.APP_DATA!, "scans"),
        join(process.env.APP_DATA!, "held-scans"),
      );
      writeFileSync(
        join(process.env.APP_DATA!, "scans"),
        "unavailable storage",
      );
      finish?.();
      return Response.json({ ok: true });
    }
    if (path === "/__fixture/finish") {
      finish?.();
      return Response.json({ ok: true });
    }
    if (path === "/__fixture/timeout") {
      ignoreKill = true;
      for (const job of _getScanJobsForTest().values())
        if (job.state === "scanning")
          job.startedAt = Date.now() - SCAN_JOB_STALE_MS - 1;
      return Response.json({ ok: true });
    }
    if (path === "/__fixture/shutdown") {
      shutdownScans();
      return Response.json({ ok: true });
    }
    return app.fetch(request);
  },
});
console.log(JSON.stringify({ port: server.port }));
