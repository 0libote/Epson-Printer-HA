export type InkKey = "black" | "cyan" | "magenta" | "yellow";
export interface InkCartridge {
  key: InkKey;
  name: string;
  color: string;
  level: number | null; // 0-100 percent, null = unknown
  state: "ok" | "low" | "empty" | "unknown";
  detail: string;
}
export interface InkStatus {
  ok: boolean;
  source: "snmp" | "ipp" | "http" | "none";
  updated_at: string;
  cartridges: InkCartridge[];
  message: string;
}

