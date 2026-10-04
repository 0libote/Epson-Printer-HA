import type { ScannerBackend, ScannerCapabilities, ScanOptions } from "./types.ts";
import { runCommand as defaultRunner } from "../system/commands.ts";
import type { createSaneService } from "./sane.ts";

export function parseSaneCapabilities(text: string): ScannerCapabilities {
 const modeLine = text.match(/--mode\s+([^\r\n]+)/)?.[1]?.split("[")[0] || "";
 const resolution = text.match(/--resolution\s+([^\r\n]+)/)?.[1]?.split("[")[0] || "";
 const step = Number(resolution.match(/in steps of ([\d.]+)/)?.[1] ?? 1);
 const modes = ["Color", "Gray", "Lineart"].filter(mode => new RegExp(`\\b${mode}\\b`).test(modeLine));
 const range = resolution.match(/(\d+)\.\.(\d+)/);
 const resolutions = range ? [150, 200, 300, 600].filter(dpi => dpi >= Number(range[1]) && dpi <= Number(range[2]) && (dpi - Number(range[1])) % step === 0)
   : [...resolution.matchAll(/\b\d+\b/g)].map(m => Number(m[0])).filter(dpi => [150,200,300,600].includes(dpi));
 const flatbed = /--source[^\r\n]*\bflatbed\b/i.test(text);
 const width = text.match(/-x\s+([\d.]+)\.\.([\d.]+)/);
 const height = text.match(/-y\s+([\d.]+)\.\.([\d.]+)/);
 const a4 = !!width && !!height && Number(width[2]) >= 210 && Number(height[2]) >= 297;
 return { modes, resolutions: [...new Set(resolutions)], sources: flatbed && a4 ? ["flatbed"] : [],
   formats: ["png", "jpg", "pdf"], verified: !!modes.length && !!resolutions.length && flatbed && a4 };
}

export class SaneBackend implements ScannerBackend {
 private capabilityPromise: Promise<ScannerCapabilities> | null = null;
 constructor(readonly id: string, readonly name: string, readonly device: string,
   private service: ReturnType<typeof createSaneService>, private runner = defaultRunner) {}
 async available(_ip: string) { return true; } // Discovery is evidence of availability, not readiness.
 async getCapabilities(_ip: string) {
  if (!this.capabilityPromise) this.capabilityPromise = this.runner(["scanimage", "--device-name", this.device, "--help"], 20_000)
    .then(result => parseSaneCapabilities(result.ok ? result.stdout : ""));
  return this.capabilityPromise;
 }
 async scan(ip: string, outputDir: string, options: ScanOptions) { const caps = await this.getCapabilities(ip); return this.service.scanDocument(ip, outputDir, { ...options, device: this.device, source: caps.verified ? "Flatbed" : undefined }); }
}
export class AirScanBackend extends SaneBackend {
 constructor(device: string, service: ReturnType<typeof createSaneService>, runner = defaultRunner) { super("airscan", "AirScan/WSD", device, service, runner); }
}
