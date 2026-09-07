import { describe, test, expect, beforeEach } from "bun:test";
import {
  cartridgeState,
  keyFromDescription,
  levelToPercent,
  parseEpsonInkHtml,
  parseIppAttributes,
  decodeSnmpResponse,
  getInkLevels,
  getCachedInkLevels,
  _setFetchImplForTest,
  _clearInkCacheForTest,
} from "../../src/ink.ts";

describe("ink - mapping and math", () => {
  test("description maps to CMYK and skips waste", () => {
    expect(keyFromDescription("Black Cartridge")).toBe("black");
    expect(keyFromDescription("BK")).toBe("black");
    expect(keyFromDescription("Cyan")).toBe("cyan");
    expect(keyFromDescription("Magenta Ink")).toBe("magenta");
    expect(keyFromDescription("Yellow")).toBe("yellow");
    expect(keyFromDescription("Waste Ink Box")).toBe(null);
    expect(keyFromDescription("Maintenance Box")).toBe(null);
    expect(keyFromDescription("Paper Tray")).toBe(null);
  });

  test("special SNMP levels handled", () => {
    expect(levelToPercent(75, 100)).toBe(75);
    expect(levelToPercent(13799, 20000)).toBe(69);
    expect(levelToPercent(-2, 100)).toBe(null);
    expect(levelToPercent(-1, 100)).toBe(null);
    expect(levelToPercent(-3, 100)).toBe(100);
    expect(levelToPercent(50, 0)).toBe(50);
  });

  test("state thresholds", () => {
    expect(cartridgeState(null)).toBe("unknown");
    expect(cartridgeState(0)).toBe("empty");
    expect(cartridgeState(10)).toBe("low");
    expect(cartridgeState(16)).toBe("ok");
    expect(cartridgeState(100)).toBe("ok");
  });
});

describe("ink - epson web scrape", () => {
  test("bar heights normalise against tallest bar", () => {
    const html = `
      <img src="Ink_K.PNG" height="40" />
      <img src="Ink_C.PNG" height="30" />
      <img src="Ink_M.PNG" height="20" />
      <img src="Ink_Y.PNG" height="10" />
    `;
    const carts = parseEpsonInkHtml(html)!;
    expect(carts.length).toBe(4);
    const byKey = Object.fromEntries(carts.map((c) => [c.key, c.level]));
    expect(byKey.black).toBe(100);
    expect(byKey.cyan).toBe(75);
    expect(byKey.magenta).toBe(50);
    expect(byKey.yellow).toBe(25);
  });

  test("text fallback finds percentages", () => {
    const html = `<html><body>Black 80 % Cyan 70 % Magenta 60 % Yellow 50 %</body></html>`;
    const carts = parseEpsonInkHtml(html)!;
    expect(carts.length).toBe(4);
    expect(carts.find((c) => c.key === "black")?.level).toBe(80);
  });

  test("empty page returns null", () => {
    expect(parseEpsonInkHtml("<html><body>no ink here</body></html>")).toBe(null);
  });
});

describe("ink - ipp parsing", () => {
  function ippResponse(levels: number[], names: string[]): Buffer {
    // minimal hand-built IPP response: version 1.1, status ok, request 1, printer-group
    const out: number[] = [0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x04];
    const pushStr = (tag: number, name: string, val: string) => {
      const nb = Buffer.from(name), vb = Buffer.from(val);
      out.push(tag, (nb.length >> 8) & 0xff, nb.length & 0xff, ...nb, (vb.length >> 8) & 0xff, vb.length & 0xff, ...vb);
    };
    const pushInt = (tag: number, name: string | null, val: number) => {
      const nb = name ? Buffer.from(name) : Buffer.alloc(0);
      const vb = Buffer.alloc(4); vb.writeInt32BE(val);
      out.push(tag, (nb.length >> 8) & 0xff, nb.length & 0xff, ...nb, 0, 4, ...vb);
    };
    names.forEach((n, i) => pushStr(0x44, i === 0 ? "marker-names" : "", n));
    levels.forEach((l, i) => pushInt(0x21, i === 0 ? "marker-levels" : "", l));
    out.push(0x03);
    return Buffer.from(out);
  }

  test("marker levels extracted incl. 1setOf continuation", () => {
    const attrs = parseIppAttributes(ippResponse([80, 70], ["Black", "Cyan"]));
    expect(attrs.get("marker-names")?.map((e) => e.value)).toEqual(["Black", "Cyan"]);
    expect(attrs.get("marker-levels")?.map((e) => e.value)).toEqual([80, 70]);
  });
});

describe("ink - snmp ber round trip", () => {
  test("decode reads back a getnext response", () => {
    const reply = makeSnmpStringResponse("Black");
    const dec = decodeSnmpResponse(reply);
    expect(dec.oid).toBe("1.3.6.1.2.1.43.11.1.1.6.1.1");
    expect(dec.error).toBe(0);
    expect(dec.value?.tag).toBe(0x04);
  });
});

// helper: hand-built SNMPv1 GetNextResponse for OID_DESC.1.1 = text, request-id 1
function makeSnmpStringResponse(text: string): Buffer {
  const tlv = (tag: number, c: number[]): number[] => {
    const len = c.length < 128 ? [c.length] : [0x81, c.length];
    return [tag, ...len, ...c];
  };
  const oidBytes = [0x2b, 0x06, 0x01, 0x02, 0x01, 0x2b, 0x0b, 0x01, 0x01, 0x06, 0x01, 0x01];
  const vb = tlv(0x30, [...tlv(0x06, oidBytes), ...tlv(0x04, Array.from(Buffer.from(text)))]);
  const pdu = tlv(0xa2, [...tlv(0x02, [1]), ...tlv(0x02, [0]), ...tlv(0x02, [0]), ...tlv(0x30, vb)]);
  return Buffer.from(tlv(0x30, [...tlv(0x02, [0]), ...tlv(0x04, Array.from(Buffer.from("public"))), ...pdu]));
}

describe("ink - cache and api", () => {
  beforeEach(() => { _clearInkCacheForTest(); _setFetchImplForTest(null); });

  test("caches success and dedups inflight", async () => {
    let calls = 0;
    _setFetchImplForTest(async (host: string) => {
      calls++;
      await Bun.sleep(5);
      return { ok: true, source: "snmp", updated_at: new Date().toISOString(), message: host, cartridges: [] };
    });
    const [a, b] = await Promise.all([getInkLevels("192.0.2.10"), getInkLevels("192.0.2.10")]);
    expect(a.message).toBe("192.0.2.10");
    expect(b.message).toBe("192.0.2.10");
    expect(calls).toBe(1);
    await getInkLevels("192.0.2.10");
    expect(calls).toBe(1); // cached
    expect(getCachedInkLevels("192.0.2.10")?.message).toBe("192.0.2.10");
    _setFetchImplForTest(null);
  });

  test("unknown when no printer configured", async () => {
    const s = await getInkLevels("");
    expect(s.ok).toBe(false);
    expect(s.cartridges.length).toBe(4);
  });

  test("/api/ink returns mocked levels and /api/status includes ink", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const tmp = mkdtempSync(join(tmpdir(), "ink-api-test-"));
    // app.ts creates APP_DIR at import time — point it somewhere writable first
    process.env.APP_DATA = tmp;
    const appModule = await import("../../src/app.ts");
    const inkModule = await import("../../src/ink.ts");
    const prevDir: string = (appModule as any).APP_DIR;
    try {
      appModule._setAppDirForTest(tmp);
      writeFileSync(join(tmp, "settings.json"), JSON.stringify({ printer_ip: "192.0.2.10" }));
      inkModule._clearInkCacheForTest();
      inkModule._setFetchImplForTest(async () => ({
        ok: true, source: "ipp", updated_at: new Date().toISOString(), message: "mock",
        cartridges: [
          { key: "black", name: "Black", color: "#1f2937", level: 80, state: "ok", detail: "mock" },
          { key: "cyan", name: "Cyan", color: "#06b6d4", level: 10, state: "low", detail: "mock" },
          { key: "magenta", name: "Magenta", color: "#ec4899", level: 0, state: "empty", detail: "mock" },
          { key: "yellow", name: "Yellow", color: "#eab308", level: null, state: "unknown", detail: "mock" },
        ],
      }));
      const res = await appModule.app.request(new Request("http://localhost/api/ink", { headers: { Accept: "application/json" } }));
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.ok).toBe(true);
      expect(body.cartridges.length).toBe(4);
      const statusRes = await appModule.app.request(new Request("http://localhost/api/status", { headers: { Accept: "application/json" } }));
      expect(statusRes.status).toBe(200);
      const statusBody: any = await statusRes.json();
      expect(statusBody.ink).toBeDefined();
      expect(statusBody.ink.cartridges.length).toBe(4);
    } finally {
      inkModule._setFetchImplForTest(null);
      inkModule._clearInkCacheForTest();
      appModule._setAppDirForTest(prevDir);
      try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    }
  });
});
