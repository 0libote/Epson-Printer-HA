import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { clearCachedCsrf, deleteScan, cancelScanJob, cancelAllScans, fetchHistory, fetchScans, postClientSettings } from "../../frontend/src/lib/api";

const originalFetch = globalThis.fetch;
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
let cookie = "";
beforeEach(() => {
  cookie = "";
  clearCachedCsrf();
  Object.defineProperty(globalThis, "document", { configurable: true, value: { get cookie() { return cookie; } } });
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
  clearCachedCsrf();
});

function mockFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}

describe("dashboard API client", () => {
  test("parallel library deletions share one initial CSRF request", async () => {
    let tokenRequests = 0;
    let deletes = 0;
    mockFetch(async (input, init) => {
      if (String(input) === "/api/csrf") {
        tokenRequests++;
        await Bun.sleep(10);
        cookie = "csrf_token=shared-token";
        return Response.json({ csrf_token: "shared-token" });
      }
      expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe("shared-token");
      deletes++;
      return Response.json({ ok: true });
    });
    await Promise.all([deleteScan("one.pdf"), deleteScan("two.pdf")]);
    expect(tokenRequests).toBe(1);
    expect(deletes).toBe(2);
  });

  for (const [name, action] of [
    ["delete", () => deleteScan("one.pdf")],
    ["cancel", () => cancelScanJob("abcdef123456")],
    ["cancel all", () => cancelAllScans()],
  ] as const) {
    test(`${name} retries a rejected CSRF token once`, async () => {
      cookie = "csrf_token=stale";
      let attempts = 0;
      mockFetch(async (_input, init) => {
        attempts++;
        if (attempts === 1) {
          cookie = "csrf_token=fresh";
          return new Response("Invalid or missing CSRF token", { status: 400 });
        }
        expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe("fresh");
        if (init?.body instanceof FormData) expect(init.body.get("_csrf_token")).toBe("fresh");
        return Response.json({ ok: true, cancelled: 1 });
      });
      await action();
      expect(attempts).toBe(2);
    });
  }

  test("an HTML fallback is never reported as a successful settings save", async () => {
    cookie = "csrf_token=token";
    mockFetch(async () => new Response("<html>Dashboard</html>", { headers: { "Content-Type": "text/html" } }));
    await expect(postClientSettings(new FormData())).rejects.toThrow();
  });

  test("list queries honour their requested limits", async () => {
    const paths: string[] = [];
    mockFetch(async input => { paths.push(String(input)); return Response.json({}); });
    await fetchHistory(20);
    await fetchScans(30);
    expect(paths).toEqual(["/api/history?limit=20", "/api/scans?limit=30"]);
  });
});
