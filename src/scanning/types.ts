import type { CommandResult } from "../system/commands.ts";
export interface ScanControl {
  isCancelled: () => boolean;
  registerProcess: (process: { kill: () => void }) => void;
  clearProcess: () => void;
  setProgress?: (progress: string) => void;
}

export type ScanOptions = { dpi?: number; mode?: string; fmt?: string; control?: ScanControl };
export type ScanResult = [CommandResult, string | null];
export type ScannerCapabilities = { resolutions: number[]; modes: string[]; sources: string[]; formats: string[]; verified: boolean };
export interface ScannerBackend {
  id: string;
  name: string;
  available(ip: string): Promise<boolean>;
  getCapabilities(ip: string): Promise<ScannerCapabilities>;
  scan(ip: string, outputDir: string, options: ScanOptions): Promise<ScanResult>;
}
