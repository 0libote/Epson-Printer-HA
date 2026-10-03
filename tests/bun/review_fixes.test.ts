import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Regression tests for the code-review pass: validation statuses, JSON
// mutation bodies, IP handling, download headers, and saturation behaviour.
describe("review fixes", () => {
  let tmp: string;
  let appModule: typeof import("../../src/app.ts");
  let historyModule: typeof import("../../src/history.ts");
  let coreModule: typeof import("../../src/core.ts");

  function createClient(app: any) {
    const jar = new Map<string, string>();
    async function request(path: string, opts: RequestInit = {}): Promise<Response> {
      const headers = new Headers(opts.headers as any);
      if (jar.size) {
        headers.set("cookie", Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join("; "));
      }
      const res = await app.request(new Request(`http://localhost${path}`, { ...opts, headers }));
      for (const sc of res.headers.getSetCookie?.() || []) {
        const m = sc.match(/^([^=]+)=([^;]*)/);
        if (m) {
          if (m[2].trim() === "" || sc.toLowerCase().includes("max-age=0")) jar.delete(m[1].trim());
          else jar.set(m[1].trim(), m[2].trim());
        }
      }
      return res;
    }
    return { request, jar };
  }

  async function getCsrf(client: ReturnType<typeof createClient>, app: any): Promise<string> {
    const text = await (await client.request("/", {})).text();
    const m = text.match(/name="_csrf_token" value="([^"]+)"/);
    return m ? m[1] : client.jar.get("csrf_token") || "";
  }

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), "review-test-"));
    process.env.APP_DATA = tmp;
    coreModule = await import("../../src/core.ts");
    historyModule = await import("../../src/history.ts");
    appModule = await import("../../src/app.ts");
    appModule._setAppDirForTest(tmp);
    historyModule._setAppDir(tmp);
    historyModule._resetHistoryState();
    appModule._setAuthForTest("", "");
    appModule._authFailures.clear();
    appModule._resetScanJobsForTest();
    appModule._clearOperationLockForTest();
    appModule._setMaxUploadForTest(128);
    appModule._setClientHostForTest("");
  });

  afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    try { appModule._setAuthForTest("", ""); } catch {}
    try { appModule._authFailures.clear(); } catch {}
    try { appModule._resetScanJobsForTest(); } catch {}
    try { appModule._clearOperationLockForTest(); } catch {}
    try { appModule._setClientHostForTest(""); } catch {}
    try { appModule._setMaxUploadForTest(128); } catch {}
    try { coreModule._resetRunLimitsForTest(); } catch {}
    delete process.env.APP_DATA;
  });

  test("empty print upload is a 400 validation error, not a 500", async () => {
    writeFileSync(join(tmp, "settings.json"), JSON.stringify({ printer_ip: "192.0.2.10" }));
    const client = createClient(appModule.app);
    const csrf = await getCsrf(client, appModule.app);
    const form = new FormData();
    form.set("_csrf_token", csrf);
    form.set("copies", "1");
    form.set("file", new File([], "empty.txt", { type: "text/plain" }));
    const res = await client.request("/print", {
      method: "POST", body: form,
      headers: { Accept: "application/json", "X-CSRF-Token": csrf },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/empty/i);
  });

  test("setup rejects network, broadcast and reserved IPv4 addresses", async () => {
    const client = createClient(appModule.app);
    const csrf = await getCsrf(client, appModule.app);
    for (const ip of ["192.168.1.0", "192.168.1.255", "0.1.2.3", "127.0.0.2", "255.255.255.255"]) {
      const form = new FormData();
      form.set("_csrf_token", csrf);
      form.set("printer_ip", ip);
      const res = await client.request("/setup", {
        method: "POST", body: form,
        headers: { Accept: "application/json", "X-CSRF-Token": csrf },
      });
      expect(res.status).toBe(400);
    }
  });

  test("CLIENT_HOST with scheme and port still yields a valid IPP URI", async () => {
    appModule._setClientHostForTest("http://192.168.1.10:8080/ignored?x=1");
    const res = await createClient(appModule.app).request("/api/status", {});
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.client_setup.ipp_uri).toBe("ipp://192.168.1.10:631/printers/Home_Epson_XP2200");
    expect(data.client_setup.ipp_uri).not.toContain("8080");
  });

  test("scan job cancel accepts a JSON body", async () => {
    appModule._resetScanJobsForTest();
    writeFileSync(join(tmp, "settings.json"), JSON.stringify({ printer_ip: "192.0.2.10" }));
    const client = createClient(appModule.app);
    const csrf = await getCsrf(client, appModule.app);
    const started = await client.request("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ dpi: 300, _csrf_token: csrf }),
    });
    expect(started.status).toBe(202);
    const { jobId } = await started.json();
    try {
      const cancel = await client.request(`/api/scan/jobs/${jobId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ _csrf_token: csrf }),
      });
      expect(cancel.status).toBe(200);
      const job = (await (await client.request(`/api/scan/jobs/${jobId}`)).json()).job;
      expect(["cancelled", "error", "done"]).toContain(job.state);
    } finally {
      appModule._resetScanJobsForTest();
    }
  });

  test("scan downloads sanitise the filename and send nosniff", async () => {
    writeFileSync(join(tmp, "scans", 'weird"name.pdf'), "%PDF-1.4\nsample\n");
    const client = createClient(appModule.app);
    const res = await client.request("/scans/weird%22name.pdf", {});
    expect(res.status).toBe(200);
    const disp = res.headers.get("content-disposition") || "";
    expect(disp).toContain('filename="weird_name.pdf"');
    expect(disp).toContain("filename*=UTF-8''weird%22name.pdf");
    expect(disp).not.toContain('"weird"name.pdf"');
  });

  test("API responses carry X-Content-Type-Options: nosniff", async () => {
    const res = await createClient(appModule.app).request("/api/status", {});
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("auth throttle trusts the server-stamped IP over X-Forwarded-For", async () => {
    appModule._setAuthForTest("admin", "correct-password");
    appModule._authFailures.clear();
    const client = createClient(appModule.app);
    const wrong = "Basic " + Buffer.from("admin:wrong").toString("base64");
    const stamped = { authorization: wrong, "x-epson-client-ip": "10.0.0.9" };
    for (let i = 0; i < appModule.AUTH_FAILURE_LIMIT; i++) {
      expect((await client.request("/", { headers: stamped })).status).toBe(401);
    }
    // Same socket IP is now throttled even when it spoofs X-Forwarded-For.
    const spoofed = await client.request("/", {
      headers: { authorization: wrong, "x-epson-client-ip": "10.0.0.9", "x-forwarded-for": "10.9.9.9" },
    });
    expect(spoofed.status).toBe(429);
    // A different socket IP is unaffected.
    const other = await client.request("/", {
      headers: { authorization: wrong, "x-epson-client-ip": "10.0.0.8" },
    });
    expect(other.status).toBe(401);
  });

  test("runCommand fails fast instead of queueing without bound", async () => {
    coreModule._setRunLimitsForTest(1, 0);
    try {
      const first = coreModule.runCommand(["sleep", "2"], 10_000);
      // Wait until the single slot is held before saturating.
      for (let i = 0; i < 100 && coreModule._runStatsForTest().active === 0; i++) {
        await Bun.sleep(20);
      }
      expect(coreModule._runStatsForTest().active).toBe(1);
      const rejected = await coreModule.runCommand(["echo", "hi"], 5_000);
      expect(rejected.ok).toBe(false);
      expect(rejected.stderr).toMatch(/server busy/);
      const done = await first;
      expect(done.ok).toBe(true);
    } finally {
      coreModule._resetRunLimitsForTest();
    }
  });

  test("history single-flight is keyed by printer, not global", async () => {
    historyModule._setAppDir(tmp);
    historyModule._resetHistoryState();
    let calls = 0;
    historyModule.__setFetchJobs(async (_which: string) => {
      calls++;
      await Bun.sleep(30);
      return {};
    });
    try {
      await Promise.all([
        historyModule.syncPrintHistory("Printer_A"),
        historyModule.syncPrintHistory("Printer_B"),
      ]);
      // 2 printers x (not-completed + completed); a global slot would give 2.
      expect(calls).toBe(4);
    } finally {
      historyModule.__setFetchJobs(async () => ({}));
    }
  });
});
