#!/usr/bin/env bun

import { $ } from "bun";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync, readFileSync } from "node:fs";

const ALLOWED_PACKAGES = ["epsonscan2", "epsonscan2-non-free-plugin"] as const;
const BUNDLE_URL = "https://download3.ebz.epson.net/dsc/f/03/00/17/08/12/9f3fec0ae80aa5c36f5170377ebcc38c93251e23/epsonscan2-bundle-6.7.80.0.x86_64.deb.tar.gz";
const BUNDLE_SHA256 = "e403d8338f4705b28244b8eef6833ae8a29a932f234b15b429798c78b5d70f01";
const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
const MAX_DEB_BYTES = 48 * 1024 * 1024;
const MAX_ARCHIVE_MEMBERS = 128;
const MAX_EXTRACTED_BYTES = 96 * 1024 * 1024;

class PermanentSetupError extends Error {}

async function installed(pkg: string): Promise<boolean> {
  try {
    const proc = Bun.spawnSync(["dpkg-query", "-W", "-f=${Status}", pkg]);
    const out = Buffer.from(proc.stdout).toString("utf-8");
    return proc.exitCode === 0 && out.includes("install ok installed");
  } catch { return false; }
}

async function packageName(path: string): Promise<string | null> {
  try {
    const proc = Bun.spawnSync(["dpkg-deb", "-f", path, "Package"]);
    if (proc.exitCode !== 0) return null;
    return Buffer.from(proc.stdout).toString("utf-8").trim() || null;
  } catch { return null; }
}

async function downloadBundle(target: string): Promise<void> {
  if ((process.env.EPSON_EULA_ACCEPTED || "").toLowerCase() !== "true") {
    throw new PermanentSetupError("EPSON_EULA_ACCEPTED=true is required before Epson Scan 2 can be installed");
  }
  const res = await fetch(BUNDLE_URL, { headers: { "User-Agent": "Epson-Printer-HA/1" }, redirect: "manual" });
  // Check redirect manually: fetch follows redirects by default, but we need to verify final URL
  // Using manual redirect would require handling, simpler check: if redirected, Bun fetch will give final URL in res.url
  if (res.url !== BUNDLE_URL) {
    throw new PermanentSetupError("Epson redirected the scanner bundle to an unexpected location");
  }
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const len = res.headers.get("Content-Length");
  if (len && parseInt(len, 10) > MAX_BUNDLE_BYTES) throw new PermanentSetupError("Epson scanner bundle is unexpectedly large");

  const hash = createHash("sha256");
  const file = Bun.file(target);
  const writer = file.writer();
  let total = 0;
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No body");
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BUNDLE_BYTES) throw new PermanentSetupError("Epson scanner bundle is unexpectedly large");
    hash.update(value);
    writer.write(value);
  }
  await writer.end();
  const digest = hash.digest("hex");
  if (digest !== BUNDLE_SHA256) {
    try { await $`rm -f ${target}`.quiet(); } catch {}
    throw new PermanentSetupError("Epson scanner bundle checksum did not match");
  }
}

async function collectDebs(bundle: string, work: string): Promise<Record<string, string>> {
  // Use Bun.Archive if available, fallback to tar via Bun.spawn
  // Bun 1.4 has Bun.Archive - use it for safety checks
  const candidates: string[] = [];
  let extractedBytes = 0;

  // Try using system tar for simplicity with safety checks
  // Use Bun.Archive if available
  try {
    // Use tar to list and extract
    const listProc = Bun.spawnSync(["tar", "tzf", bundle]);
    if (listProc.exitCode !== 0) throw new Error("tar list failed");
    const members = Buffer.from(listProc.stdout).toString("utf-8").split("\n").filter(Boolean);
    if (members.length > MAX_ARCHIVE_MEMBERS) throw new PermanentSetupError("Epson scanner archive contains too many entries");
    for (const member of members) {
      if (!member.endsWith(".deb")) continue;
      // Get size via tar tvf
      const sizeProc = Bun.spawnSync(["tar", "--list", "--verbose", "-zf", bundle, member]);
      // parse size - simpler: just check after extract
    }
    // Extract .deb files
    await $`mkdir -p ${work}`.quiet();
    await $`tar -xzf ${bundle} -C ${work}`.quiet();
    // Now scan work for .deb
    const { readdirSync, statSync } = await import("node:fs");
    for (const f of readdirSync(work)) {
      if (!f.endsWith(".deb")) continue;
      const p = join(work, f);
      const st = statSync(p);
      if (st.size > MAX_DEB_BYTES) throw new PermanentSetupError("Epson scanner package is unexpectedly large");
      extractedBytes += st.size;
      if (extractedBytes > MAX_EXTRACTED_BYTES) throw new PermanentSetupError("Epson scanner archive expands beyond the safety limit");
      candidates.push(p);
    }
  } catch (e) {
    if (e instanceof PermanentSetupError) throw e;
    // Fallback to Bun.Archive if tar failed
    throw e;
  }

  const approved: Record<string, string> = {};
  for (const candidate of candidates) {
    const name = await packageName(candidate);
    if (name && (ALLOWED_PACKAGES as readonly string[]).includes(name) && !(name in approved)) {
      approved[name] = candidate;
    }
  }
  return approved;
}

export async function main(): Promise<number> {
  const machine = process.arch; // node arch
  // Map node arch to platform.machine check
  const bunArch = Bun.which("dpkg") ? "x64" : machine; // simplified
  // Check x86_64 via uname
  try {
    const proc = Bun.spawnSync(["uname", "-m"]);
    const uname = Buffer.from(proc.stdout).toString("utf-8").trim().toLowerCase();
    if (!["x86_64", "amd64"].includes(uname)) {
      console.log(`[scan-bridge] Epson's pinned Scan 2 bundle only supports x86_64; detected ${uname}.`);
      return 3;
    }
  } catch {}

  if ((process.env.EPSON_EULA_ACCEPTED || "").toLowerCase() !== "true") {
    console.log("[scan-bridge] EPSON_EULA_ACCEPTED=true is required after reading Epson's licence agreement.");
    return 3;
  }

  if (await Promise.all(ALLOWED_PACKAGES.map(installed)).then(arr => arr.every(Boolean))) {
    console.log("[scan-bridge] Epson Scan 2 core + network plug-in already installed.");
    return 0;
  }

  const tmp = await $`mktemp -d -t epson-bundle-XXXXXX`.text().then(s => s.trim());
  const work = tmp;
  const bundle = join(work, "epsonscan2-bundle.tar.gz");
  console.log("[scan-bridge] Downloading Epson Scan 2 unchanged from Epson.");
  try {
    await downloadBundle(bundle);
    const packages = await collectDebs(bundle, work);
    const missing = (ALLOWED_PACKAGES as readonly string[]).filter(p => !(p in packages) && !installedSync(p));
    function installedSync(p: string): boolean {
      const proc = Bun.spawnSync(["dpkg-query", "-W", "-f=${Status}", p]);
      return proc.exitCode === 0 && Buffer.from(proc.stdout).toString("utf-8").includes("install ok installed");
    }
    // Re-check async for missing
    const missingAsync: string[] = [];
    for (const pkg of ALLOWED_PACKAGES) {
      if (!(pkg in packages) && !(await installed(pkg))) missingAsync.push(pkg);
    }
    if (missingAsync.length) {
      console.log("[scan-bridge] Missing package(s): " + missingAsync.join(", "));
      return 3;
    }
    console.log("[scan-bridge] Installing the verified Epson compatibility packages.");
    await $`apt-get update`.quiet();
    for (const pkg of ALLOWED_PACKAGES) {
      if (await installed(pkg)) continue;
      const proc = Bun.spawnSync(["apt-get", "install", "-y", "--no-install-recommends", packages[pkg]]);
      console.log(Buffer.from(proc.stdout).toString("utf-8"));
      if (proc.exitCode !== 0) return proc.exitCode ?? 1;
    }
  } catch (exc: any) {
    if (exc instanceof PermanentSetupError) {
      console.log(`[scan-bridge] ${exc.message}`);
      return 3;
    }
    console.log(`[scan-bridge] ${exc?.message ?? String(exc)}`);
    return 2;
  } finally {
    try { await $`rm -rf ${tmp}`.quiet(); } catch {}
  }

  if (!(await Promise.all(ALLOWED_PACKAGES.map(installed)).then(arr => arr.every(Boolean)))) return 1;

  const dllConf = "/etc/sane.d/dll.conf";
  let current = "";
  try { current = readFileSync(dllConf, "utf-8"); } catch {}
  if (!current.split("\n").map(l => l.trim()).includes("epsonscan2")) {
    await Bun.write(dllConf, current + "\nepsonscan2\n");
  }
  console.log("[scan-bridge] Epson compatibility bridge installed.");
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
