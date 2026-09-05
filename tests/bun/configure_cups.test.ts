import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeCommand(path: string, body: string) {
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  chmodSync(path, 0o755);
}

async function runConfigure(tmp: string, protocol: string, pythonBody: string): Promise<{ result: any; args: string[] }> {
  const commands = join(tmp, "bin");
  mkdirSync(commands, { recursive: true });
  const record = join(tmp, "lpadmin.args");
  // create fake python3 that handles our pythonBody check for tcpOpen simulation
  makeCommand(join(commands, "python3"), pythonBody);
  makeCommand(join(commands, "lpstat"), "exit 0");
  makeCommand(join(commands, "lpinfo"), "echo 'epson.ppd Epson XP-2200 Series'");
  makeCommand(join(commands, "lpadmin"), 'printf "%s\\n" "$@" > "$LPADMIN_RECORD"');
  for (const name of ["lpoptions", "cupsaccept", "cupsenable"]) makeCommand(join(commands, name), "exit 0");

  const env = {
    ...process.env,
    PATH: `${commands}:${process.env.PATH}`,
    PRINTER_IP: "192.0.2.10",
    PRINTER_NAME: "Test_Epson",
    PRINT_PROTOCOL: protocol,
    LPADMIN_RECORD: record,
    PREFER_ENV_SETTINGS: "true",
    CUPS_LOCK_DIR: tmp,
    CUPS_READY_ATTEMPTS: "2",
  } as Record<string,string>;

  const proc = Bun.spawn(["bash", "scripts/configure-cups.sh"], { env, stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  const args = existsSync(record) ? readFileSync(record, "utf-8").split("\n").filter(Boolean) : [];
  return { result: { returncode: code, stdout, stderr }, args };
}

function assertIpp(args: string[]) {
  const idx = args.indexOf("-v");
  expect(args[idx + 1]).toBe("ipp://192.0.2.10:631/ipp/print?version=1.1");
}

describe("configure-cups", () => {
  test("sleeping printer still gets ipp queue", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "cups-test-"));
    try {
      const { result, args } = await runConfigure(tmp, "auto", "exit 1");
      expect(result.returncode).toBe(0);
      expect(result.stdout + result.stderr).toContain("offline; configuring the XP-2200 IPP default");
      assertIpp(args);
    } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch {} }
  });

  test("stale socket setting self heals to ipp", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "cups-test-"));
    try {
      const { result, args } = await runConfigure(tmp, "socket", '[ "$3" = "631" ]');
      expect(result.returncode).toBe(0);
      expect(result.stdout + result.stderr).toContain("switching the saved socket setting to IPP");
      assertIpp(args);
    } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch {} }
  });
});
