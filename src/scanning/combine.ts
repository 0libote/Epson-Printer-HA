import { PDFDocument } from "pdf-lib";
import { lstat, readFile, link, unlink } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { randomBytes } from "node:crypto";

export class CombineError extends Error {
  constructor(
    message: string,
    public status: 400 | 404 | 409 | 413 = 400,
  ) {
    super(message);
  }
}
const MAX_INPUT_BYTES = 128 * 1024 * 1024;
const MAX_PAGES = 100;

/** Assemble existing scans in the requested order. Publish exclusively and
 * atomically so readers never see a partial PDF and existing files survive. */
export async function combineScans(
  directory: string,
  names: string[],
  output: string,
) {
  if (
    !Array.isArray(names) ||
    names.length < 2 ||
    names.length > 50 ||
    names.some((name) => typeof name !== "string")
  )
    throw new CombineError("Choose between 2 and 50 saved scans.");
  if (new Set(names).size !== names.length)
    throw new CombineError("Each scan can only appear once.");
  const validName = (name: string) =>
    name === basename(name) &&
    !name.startsWith(".") &&
    !/[\\/\x00-\x1f]/.test(name) &&
    [".pdf", ".png", ".jpg", ".jpeg"].includes(extname(name).toLowerCase());
  if (
    names.some((name) => !validName(name)) ||
    !validName(output) ||
    extname(output).toLowerCase() !== ".pdf"
  )
    throw new CombineError(
      "Use valid saved scan filenames and a PDF output name.",
    );
  let bytes = 0;
  // Check the full input budget before decoding any PDF or image.
  for (const name of names) {
    let stat;
    try {
      stat = await lstat(join(directory, name));
    } catch {
      throw new CombineError(
        `“${name}” is no longer available. Refresh saved scans.`,
        404,
      );
    }
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new CombineError("Only saved scan files can be combined.");
    bytes += stat.size;
    if (bytes > MAX_INPUT_BYTES)
      throw new CombineError(
        "Selected scans exceed 128 MB. Combine fewer files at a time.",
        413,
      );
  }
  const document = await PDFDocument.create();
  document.setTitle(output.replace(/\.pdf$/i, ""));
  document.setCreator("Print Room");
  for (const name of names) {
    const data = await readFile(join(directory, name));
    try {
      if (extname(name).toLowerCase() === ".pdf") {
        const source = await PDFDocument.load(data);
        if (source.isEncrypted) throw new Error("encrypted PDF");
        if (document.getPageCount() + source.getPageCount() > MAX_PAGES)
          throw new CombineError(
            "A combined document can contain at most 100 pages.",
            413,
          );
        const pages = await document.copyPages(source, source.getPageIndices());
        for (const page of pages) document.addPage(page);
      } else {
        if (document.getPageCount() >= MAX_PAGES)
          throw new CombineError(
            "A combined document can contain at most 100 pages.",
            413,
          );
        const image =
          extname(name).toLowerCase() === ".png"
            ? await document.embedPng(data)
            : await document.embedJpg(data);
        const page = document.addPage([595.28, 841.89]);
        const scale = Math.min(
          (page.getWidth() - 36) / image.width,
          (page.getHeight() - 36) / image.height,
        );
        const width = image.width * scale,
          height = image.height * scale;
        page.drawImage(image, {
          x: (page.getWidth() - width) / 2,
          y: (page.getHeight() - height) / 2,
          width,
          height,
        });
      }
    } catch (error) {
      if (error instanceof CombineError) throw error;
      throw new CombineError(
        `Could not read “${name}”. It may be damaged or password protected.`,
      );
    }
  }
  if (!document.getPageCount())
    throw new CombineError("The selected documents contain no pages.");
  const result = await document.save();
  if (result.byteLength > MAX_INPUT_BYTES)
    throw new CombineError(
      "The combined PDF exceeds 128 MB. Choose fewer scans.",
      413,
    );
  const temporary = join(
    directory,
    `.combine-${randomBytes(8).toString("hex")}.pdf`,
  );
  try {
    await Bun.write(temporary, result);
    try {
      await link(temporary, join(directory, output));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new CombineError(
          "A scan with that name already exists. Choose a different name.",
          409,
        );
      throw error;
    }
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return { name: output, pages: document.getPageCount() };
}
