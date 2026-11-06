import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SMB = readFileSync(join(import.meta.dir, "../../config/smb.conf"), "utf-8");
const SUPERVISOR = readFileSync(join(import.meta.dir, "../../config/supervisord.conf"), "utf-8");
const DOCKERFILE = readFileSync(join(import.meta.dir, "../../Dockerfile"), "utf-8");
const WSDD_SH = readFileSync(join(import.meta.dir, "../../scripts/run-wsdd.sh"), "utf-8");

describe("windows discovery", () => {
  test("samba shares CUPS printers to guests without a server-side driver", () => {
    expect(SMB).toContain("printing = cups");
    expect(SMB).toContain("load printers = yes");
    expect(SMB).toContain("use client driver = yes");
    expect(SMB).toContain("guest ok = yes");
    expect(SMB).toContain("printable = yes");
  });

  test("samba refuses legacy protocols", () => {
    expect(SMB).toContain("server min protocol = SMB2");
  });

  test("supervisor runs smbd and wsdd", () => {
    expect(SUPERVISOR).toContain("[program:smbd]");
    expect(SUPERVISOR).toContain("smbd --interactive");
    expect(SUPERVISOR).toContain("[program:wsdd]");
  });

  test("image installs samba and wsdd", () => {
    expect(DOCKERFILE).toMatch(/samba/);
    expect(DOCKERFILE).toMatch(/wsdd/);
  });

  test("wsdd binds the LAN interface, not docker bridges", () => {
    expect(WSDD_SH).toContain("ip route show default");
    expect(WSDD_SH).toContain("-i");
  });

  test("new files are wired into the image", () => {
    expect(DOCKERFILE).toContain("config/smb.conf");
    expect(DOCKERFILE).toContain("run-wsdd.sh");
    expect(existsSync(join(import.meta.dir, "../../config/smb.conf"))).toBe(true);
    expect(existsSync(join(import.meta.dir, "../../scripts/run-wsdd.sh"))).toBe(true);
  });
});
