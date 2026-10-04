import { test, expect } from "bun:test";
test("Python sidecar and installer contracts", async () => {
 const proc = Bun.spawn(["python3", "-m", "unittest", "discover", "-s", "tests/python", "-v"], { stdout: "pipe", stderr: "pipe" });
 const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
 if (code !== 0) console.error(stdout, stderr);
 expect(code).toBe(0);
});
