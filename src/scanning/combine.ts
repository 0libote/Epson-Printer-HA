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

function validName(name: string) {
  return (
    name === basename(name) &&
    !name.startsWith(".") &&
    !/[\\/\x00-\x1f]/.test(name) &&
    [".pdf", ".png", ".jpg", ".jpeg"].includes(extname(name).toLowerCase())
  );
}

function validateSelection(names: string[], output: string) {
  if (
    !Array.isArray(names) ||
    names.length < 2 ||
    names.length > 50 ||
    names.some((name) => typeof name !== "string")
  )
    throw new CombineError("Choose between 2 and 50 saved scans.");
  if (new Set(names).size !== names.length)
    throw new CombineError("Each scan can only appear once.");
  if (
    names.some((name) => !validName(name)) ||
    !validName(output) ||
    extname(output).toLowerCase() !== ".pdf"
  )
    throw new CombineError(
      "Use valid saved scan filenames and a PDF output name.",
    );
}

async function inputSize(directory: string, name: string) {
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
  return stat.size;
}

function checkPageBudget(document: PDFDocument, additional: number) {
  if (document.getPageCount() + additional > MAX_PAGES)
    throw new CombineError(
      "A combined document can contain at most 100 pages.",
      413,
    );
}

async function appendPdf(document: PDFDocument, data: Uint8Array) {
  const source = await PDFDocument.load(data);
  if (source.isEncrypted) throw new Error("encrypted PDF");
  checkPageBudget(document, source.getPageCount());
  const pages = await document.copyPages(source, source.getPageIndices());
  for (const page of pages) document.addPage(page);
}

async function appendImage(
  document: PDFDocument,
  data: Uint8Array,
  png: boolean,
) {
  checkPageBudget(document, 1);
  const image = png
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

async function appendScan(
  document: PDFDocument,
  directory: string,
  name: string,
) {
  const data = await readFile(join(directory, name));
  try {
    const extension = extname(name).toLowerCase();
    if (extension === ".pdf") await appendPdf(document, data);
    else await appendImage(document, data, extension === ".png");
  } catch (error) {
    if (error instanceof CombineError) throw error;
    throw new CombineError(
      `Could not read “${name}”. It may be damaged or password protected.`,
    );
  }
}

async function publish(directory: string, output: string, result: Uint8Array) {
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
}

/** Assemble in order, then publish exclusively so existing files survive. */
export async function combineScans(
  directory: string,
  names: string[],
  output: string,
) {
  validateSelection(names, output);
  // Metadata probes can run together; enforce the budget before decoding bytes.
  const sizes = await Promise.all(
    names.map((name) => inputSize(directory, name)),
  );
  if (sizes.reduce((total, size) => total + size, 0) > MAX_INPUT_BYTES)
    throw new CombineError(
      "Selected scans exceed 128 MB. Combine fewer files at a time.",
      413,
    );
  const document = await PDFDocument.create();
  document.setTitle(output.replace(/\.pdf$/i, ""));
  document.setCreator("Print Room");
  // Chain decoding sequentially to bound peak image/PDF memory and keep order.
  await names.reduce(
    (previous, name) =>
      previous.then(() => appendScan(document, directory, name)),
    Promise.resolve(),
  );
  if (!document.getPageCount())
    throw new CombineError("The selected documents contain no pages.");
  const result = await document.save();
  if (result.byteLength > MAX_INPUT_BYTES)
    throw new CombineError(
      "The combined PDF exceeds 128 MB. Choose fewer scans.",
      413,
    );
  await publish(directory, output, result);
  return { name: output, pages: document.getPageCount() };
}
