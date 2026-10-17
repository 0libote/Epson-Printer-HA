import { expect, spyOn, test } from "bun:test";
import { createSubmissionId } from "../../frontend/src/lib/submission-id";

test("HTTP LAN origins can create submission IDs without randomUUID", () => {
  const uuid = spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => {
    throw new Error("randomUUID is unavailable on this origin");
  });
  const random = spyOn(globalThis.crypto, "getRandomValues").mockImplementation((bytes: Uint8Array) => {
    bytes.set(Array.from({ length: 16 }, (_, index) => index));
    return bytes;
  });
  try {
    expect(createSubmissionId()).toBe("000102030405060708090a0b0c0d0e0f");
    expect(random).toHaveBeenCalledTimes(1);
    expect(uuid).not.toHaveBeenCalled();
  } finally {
    random.mockRestore();
    uuid.mockRestore();
  }
});
