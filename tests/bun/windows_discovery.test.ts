import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SUPERVISOR = readFileSync(join(import.meta.dir, "../../config/supervisord.conf"), "utf-8");
const DOCKERFILE = readFileSync(join(import.meta.dir, "../../Dockerfile"), "utf-8");
const WSDD_SH = readFileSync(join(import.meta.dir, "../../scripts/run-wsdd.sh"), "utf-8");

describe("windows discovery", () => {
  test("supervisor runs wsdd and nothing else for discovery", () => {
    expect(SUPERVISOR).toContain("[program:wsdd]");
    expect(SUPERVISOR).not.toContain("[program:smbd]");
  });

  test("image installs wsdd but no samba server", () => {
    expect(DOCKERFILE).toMatch(/wsdd/);
    expect(DOCKERFILE).not.toMatch(/samba/);
  });

  test("wsdd binds the LAN interface, not docker bridges", () => {
    expect(WSDD_SH).toContain("ip route show default");
    expect(WSDD_SH).toContain("-i");
  });

  test("no samba leftovers", () => {
    expect(existsSync(join(import.meta.dir, "../../config/smb.conf"))).toBe(false);
    expect(existsSync(join(import.meta.dir, "../../scripts/run-smbd.sh"))).toBe(false);
  });
});
