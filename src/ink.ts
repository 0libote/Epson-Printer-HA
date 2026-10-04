// Backwards-compatible ink API; the standard fallback chain remains intact.
export * from "./printer/ink-types.ts";
export { cartridgeState, keyFromDescription, levelToPercent } from "./printer/ink-common.ts";
export { decodeSnmpResponse } from "./printer/snmp.ts";
export { parseIppAttributes, parsePrinterSupplyEntry } from "./printer/ipp.ts";
export { EPSON_WEB_FULL_BAR_PX, parseEpsonInkHtml } from "./printer/web-status.ts";
export * from "./printer/standard.ts";
