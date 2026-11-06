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
    expect(SMB).toContain("printcap name = /run/cups/printcap");
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
    expect(SUPERVISOR).toContain("run-smbd.sh");
    expect(SUPERVISOR).toContain("[program:wsdd]");
  });

  test("smbd waits for the CUPS queue before snapshotting printcap", () => {
    const RUN_SMBD = readFileSync(join(import.meta.dir, "../../scripts/run-smbd.sh"), "utf-8");
    expect(RUN_SMBD).toContain("lpstat -p");
    expect(RUN_SMBD).toContain("smbd --interactive");
    expect(SMB).toContain("printcap cache time");
  });

  test("cups configurator owns one generated share file", () => {
    const CONFIGURE = readFileSync(join(import.meta.dir, "../../scripts/configure-cups.sh"), "utf-8");
    expect(SMB).toContain("include = /etc/samba/shares.conf");
    expect(CONFIGURE).toContain("/etc/samba/shares.conf");
    expect(CONFIGURE).toContain("smbcontrol smbd reload-config");
    expect(CONFIGURE).toContain("printer name = $PRINTER_NAME");
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
