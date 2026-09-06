import { describe, test, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as core from "../../src/core.ts";

describe("core", () => {
  test("image only enables supported scanner backends", async () => {
    const dockerfile = readFileSync(join(import.meta.dir, "../../Dockerfile"), "utf-8");
    expect(dockerfile).toContain("printf 'airscan\\nepsonds\\nnet\\n' > /etc/sane.d/dll.conf");
  });

  test("cancel rejects bad job id", async () => {
    const result = await core.cancelJob("; rm -rf /");
    expect(result.ok).toBe(false);
  });

  test("submit print uses argument list and service identity", async () => {
    const mockRun = spyOn(core, "runCommand").mockResolvedValue({ ok: true, stdout: "request id is x-1", stderr: "", returncode: 0 });
    const result = await core.submitPrint("Home_Epson_XP2200", "/tmp/example.pdf", { copies: 2, grayscale: true });
    expect(result.ok).toBe(true);
    const args = mockRun.mock.calls[0][0] as string[];
    expect(args.slice(0, 10)).toEqual([
      "lp", "-U", "epson", "-d", "Home_Epson_XP2200",
      "-t", "example.pdf", "-n", "2", "-o",
    ]);
    expect(args.slice(-3)).toEqual(["-o", "Ink=MONO", "/tmp/example.pdf"]);
    mockRun.mockRestore();
  });

  test("status parses ready", async () => {
    const mockRun = spyOn(core, "runCommand").mockResolvedValue({ ok: true, stdout: "printer Home_Epson_XP2200 is idle. enabled since today", stderr: "", returncode: 0 });
    const status = await core.cupsPrinterStatus("Home_Epson_XP2200");
    expect(status.ok).toBe(true);
    expect(status.state).toBe("ready");
    mockRun.mockRestore();
  });

  test("airscan device is preferred and identified", async () => {
    const mockRun = spyOn(core, "runCommand").mockResolvedValue({
      ok: true,
      stdout: [
        "device `net:127.0.0.1:epsonscan2:XP-2200' is a Epson network scanner",
        "device `airscan:e0:Epson XP-2200' is a eSCL Epson XP-2200 ip=192.0.2.10",
      ].join("\n"),
      stderr: "", returncode: 0
    });
    const [device, backend] = await core.detectSaneDevice();
    expect(device).toBe("airscan:e0:Epson XP-2200");
    expect(backend).toBe("AirScan/WSD");
    mockRun.mockRestore();
  });

  test("sidecar is identified as compatibility bridge", async () => {
    const mockRun = spyOn(core, "runCommand").mockResolvedValue({
      ok: true,
      stdout: "device `net:127.0.0.1:epsonscan2:XP-2200' is a Epson XP-2200 network scanner",
      stderr: "", returncode: 0
    });
    const [device, backend] = await core.detectSaneDevice();
    expect(device).toBe("net:127.0.0.1:epsonscan2:XP-2200");
    expect(backend).toBe("Epson compatibility bridge");
    mockRun.mockRestore();
  });

  test("scanner discovery only selects configured printer", async () => {
    const mockRun = spyOn(core, "runCommand").mockResolvedValue({
      ok: true,
      stdout: [
        "device `airscan:e0:Epson Office' is a eSCL Epson scanner ip=192.0.2.50",
        "device `airscan:e1:Epson XP-2200' is a eSCL Epson XP-2200 ip=192.0.2.10",
      ].join("\n"),
      stderr: "", returncode: 0
    });
    const [device, backend] = await core.detectSaneDevice("192.0.2.10");
    expect(device).toBe("airscan:e1:Epson XP-2200");
    expect(backend).toBe("AirScan/WSD");
    mockRun.mockRestore();
  });

  test("scanner discovery does not match an ip prefix", async () => {
    const mockRun = spyOn(core, "runCommand").mockResolvedValue({
      ok: true,
      stdout: "device `airscan:e0:Epson Office' is a eSCL Epson scanner ip=192.0.2.100",
      stderr: "", returncode: 0
    });
    const res = await core.detectSaneDevice("192.0.2.10");
    expect(res).toEqual([null, null]);
    mockRun.mockRestore();
  });

  test("open source epsonds backend is accepted for configured ip", async () => {
    const mockRun = spyOn(core, "runCommand").mockResolvedValue({
      ok: true,
      stdout: "device `epsonds:net:192.0.2.10' is a Epson XP-2200 Series flatbed scanner",
      stderr: "", returncode: 0
    });
    const res = await core.detectSaneDevice("192.0.2.10");
    expect(res).toEqual(["epsonds:net:192.0.2.10", "Open-source SANE"]);
    mockRun.mockRestore();
  });

  test("scanner status is fast and briefly cached", async () => {
    // clear caches
    core.clearStatusCaches();
    const mockTcp = spyOn(core, "tcpOpen").mockResolvedValue(true);
    // need to mock performance.now to stable bucket? Use real time but check caching via call count
    const first = await core.scannerStatus("192.0.2.10");
    const second = await core.scannerStatus("192.0.2.10");
    expect(first).toEqual(second);
    expect(first.state).toBe("ready");
    expect(mockTcp).toHaveBeenCalledTimes(1);
    mockTcp.mockRestore();
  });

  test("scanner status reports starting without blocking", async () => {
    core.clearStatusCaches();
    const mockTcp = spyOn(core, "tcpOpen").mockResolvedValue(false);
    const status = await core.scannerStatus("192.0.2.10");
    expect(status.state).toBe("starting");
    mockTcp.mockRestore();
  });
});
