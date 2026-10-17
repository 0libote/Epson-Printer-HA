import type { Hono } from "hono";
import { join, extname } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { parsePrintOptions } from "../printing/options.ts";
import {
  createPrintSubmissions,
  type SubmissionResult,
} from "../printing/submissions.ts";
import type { CupsBackend } from "../printing/types.ts";

export function registerPrintingApi(
  app: Hono,
  deps: {
    auth: (c: any) => Response | null;
    ip: () => string;
    queue: () => string;
    dataDir: () => string;
    uploadLimit: () => number;
    csrf: (c: any, body: unknown) => boolean;
    readBody: (c: any) => Promise<unknown>;
    wantsJson: (c: any) => boolean;
    flash: (c: any, category: string, message: string) => void;
    filename: (name: string) => string;
    validateUpload: (
      buffer: ArrayBuffer,
      size: number,
      suffix: string,
    ) => string | null;
    queueStatus: CupsBackend["getStatus"];
    submit: CupsBackend["submitJob"];
    resume: CupsBackend["resumeQueue"];
    lock: <T>(
      action: () => Promise<T>,
    ) => Promise<{ acquired: boolean; result?: T }>;
    invalidate: () => void;
  },
) {
  app.post("/api/printer/queue/resume", async (c) => {
    const auth = deps.auth(c);
    if (auth) return auth;
    const body = await deps.readBody(c);
    if (!deps.csrf(c, body))
      return c.text("Invalid or missing CSRF token", 400);
    if (!deps.ip())
      return c.json({ ok: false, error: "Set up the printer first." }, 400);
    const result = await deps.lock(() => deps.resume(deps.queue()));
    if (!result.acquired)
      return c.json(
        {
          ok: false,
          error:
            "Printer settings or maintenance are being updated. Try again shortly.",
        },
        409,
      );
    deps.invalidate();
    if (!result.result?.ok)
      return c.json(
        {
          ok: false,
          error:
            "The print queue could not be resumed. Check the hub's CUPS service in Settings.",
        },
        503,
      );
    return c.json({
      ok: true,
      message: "The print queue is accepting jobs again.",
    });
  });
  const submitOnce = createPrintSubmissions(deps.dataDir);
  app.post("/print", async (c) => {
    const auth = deps.auth(c);
    if (auth) return auth;
    const respond = (result: SubmissionResult) => {
      if (deps.wantsJson(c)) return c.json(result.body, result.status);
      deps.flash(
        c,
        result.body.ok ? "success" : "error",
        result.body.message || result.body.error || "Print failed.",
      );
      return c.redirect("/", 302);
    };
    const fail = (error: string, status: SubmissionResult["status"] = 400) =>
      respond({ status, body: { ok: false, error } });
    if (!deps.ip()) return fail("Set up the printer first.");
    const body = await c.req.parseBody();
    if (!deps.csrf(c, body))
      return c.text("Invalid or missing CSRF token", 400);
    const file = body.file;
    if (!(file instanceof File) || !file.name)
      return fail("Choose a file first.");
    const name = deps.filename(file.name).slice(-180);
    const suffix = extname(name).toLowerCase();
    if (![".pdf", ".png", ".jpg", ".jpeg", ".txt"].includes(suffix))
      return fail("Supported files: PDF, PNG, JPG and TXT.");
    let options;
    try {
      options = parsePrintOptions(body);
    } catch (error) {
      return fail((error as Error).message);
    }
    if (options.pages && suffix !== ".pdf")
      return fail(
        "Page selection is available for PDF documents. Leave pages blank for this file.",
      );
    if (file.size > deps.uploadLimit() * 1024 * 1024) {
      const error = `That file is too large. The limit is ${deps.uploadLimit()} MB.`;
      if (deps.wantsJson(c)) return c.json({ ok: false, error }, 413);
      deps.flash(c, "error", error);
      return c.redirect("/", 302);
    }
    const key = String(body.submission_id ?? "");
    if (key && !/^[A-Za-z0-9_-]{16,80}$/.test(key))
      return fail("Invalid submission ID.");
    const buffer = await file.arrayBuffer();
    const validationError = deps.validateUpload(buffer, file.size, suffix);
    if (validationError) return fail(validationError);
    const queueName = deps.queue();
    const printerIp = deps.ip();
    const action = async (): Promise<SubmissionResult> => {
      const queueStatus = await deps.queueStatus(queueName);
      if (!queueStatus.ok || queueStatus.state === "disabled") {
        return {
          status: 503,
          body: {
            ok: false,
            retry_safe: true,
            error: `Print queue '${queueName}' is not ready (${queueStatus.detail || queueStatus.state}). Re-save the printer settings, then try again.`,
          },
        };
      }
      const uploadDir = join(deps.dataDir(), "uploads");
      mkdirSync(uploadDir, { recursive: true });
      const workDir = join(
        uploadDir,
        `print-${randomBytes(6).toString("hex")}`,
      );
      mkdirSync(workDir, { mode: 0o700 });
      try {
        const target = join(workDir, name);
        await Bun.write(target, buffer);
        const locked = await deps.lock(async () => {
          if (deps.queue() !== queueName || deps.ip() !== printerIp) {
            return {
              ok: false,
              stdout: "",
              stderr:
                "Printer settings changed during the upload. Review them before trying again.",
              returncode: 1,
            };
          }
          return deps.submit(queueName, target, { ...options, title: name });
        });
        if (!locked.acquired)
          return {
            status: 409,
            body: {
              ok: false,
              retry_safe: true,
              error:
                "Printer settings or maintenance are being updated. Try again when that finishes.",
            },
          };
        deps.invalidate();
        const result = locked.result!;
        const detail = String(result.stderr || result.stdout || "")
          .trim()
          .slice(0, 800);
        if (!result.ok) {
          console.error(
            `[print] lp failed queue=${queueName}: ${detail || result.returncode}`,
          );
          return {
            status: 500,
            body: { ok: false, error: detail || "Print failed." },
          };
        }
        const jobId = result.stdout.match(
          /request id is ([A-Za-z0-9_.-]+-\d+)/,
        )?.[1];
        return {
          status: 200,
          body: {
            ok: true,
            message: "File added to the print queue.",
            job_id: jobId,
          },
        };
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    };
    if (!key) return respond(await action()); // Existing form/API clients remain supported.
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([queueName, printerIp, name, options]))
      .update(new Uint8Array(buffer))
      .digest("hex");
    try {
      return respond(await submitOnce(key, fingerprint, action));
    } catch (error) {
      console.error("[print] could not store submission receipt", error);
      return fail(
        "Print submission storage is unavailable. Check the hub's data volume and try again.",
        503,
      );
    }
  });
}
