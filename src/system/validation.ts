export function validatePrinterAddress(value: string): string {
 const parts = value.split(".");
 if (parts.length !== 4 || parts.some(p => !/^(0|[1-9]\d{0,2})$/.test(p) || Number(p) > 255)) throw new Error("Invalid printer IPv4 address");
 const [first,,,last] = parts.map(Number);
 if (first === 0 || first === 127 || first >= 224 || last === 0 || last === 255) throw new Error("Invalid printer IPv4 address");
 return value;
}
export function validateQueue(value: string): string {
 if (!/^[A-Za-z0-9._][A-Za-z0-9._-]{0,126}$/.test(value) || [".", ".."].includes(value)) throw new Error("Invalid queue name");
 return value;
}
