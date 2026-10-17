/** getRandomValues also works on HTTP LAN origins, where randomUUID may not. */
export function createSubmissionId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
