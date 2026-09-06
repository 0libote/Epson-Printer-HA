import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const POLICY = readFileSync(join(import.meta.dir, "../../config/cupsd.conf"), "utf-8");

describe("cups policy", () => {
  test("denies unlisted operations", () => {
    const allLimit = POLICY.split("<Limit All>")[1].split("</Limit>")[0];
    expect(allLimit).toContain("Order allow,deny");
    expect(allLimit).toContain("Deny all");
  });

  test("explicitly allows lan printing", () => {
    const printLimit = POLICY.split("<Limit Create-Job")[1].split("</Limit>")[0];
    expect(printLimit).toContain("Send-Document");
    expect(printLimit).toContain("Deny all");
    expect(printLimit).toContain("Allow @LOCAL");
  });

  test("restricts job mutation to local dashboard or authenticated owner", () => {
    const jobLimit = POLICY.split("<Limit Cancel-Job")[1].split("</Limit>")[0];
    expect(jobLimit).toContain("Deny all");
    expect(jobLimit).toContain("Allow localhost");
    expect(jobLimit).toContain("Require user @OWNER @SYSTEM");
  });
});
