import { PDFDocument } from "pdf-lib";
import { unlinkSync, renameSync } from "node:fs";
import { commandResult, type CommandResult } from "../system/commands.ts";
import type { ScanControl } from "./types.ts";
function jpegQualityForDpi(dpi: number) { return dpi >= 600 ? 92 : dpi >= 300 ? 90 : 88; }
export async function finishScan(pngPath: string, outputDir: string, stamp: string, dpi: number, fmt: string, opts: { control?: ScanControl } = {}): Promise<[CommandResult, string | null]> {
 const safeUnlink = (p: string) => { try { unlinkSync(p); } catch {} };
  const publish = async (path: string): Promise<[CommandResult, string | null]> => {
    if (opts.control?.isCancelled()) {
      safeUnlink(path);
      safeUnlink(pngPath);
      return [commandResult(false, "", "scan_cancelled", 130), null];
    }
    const target = path.replace("/.scan_", "/scan_");
    const { renameSync } = await import("node:fs");
    renameSync(path, target);
    return [commandResult(true, target), target];
  };
  const pngFile = Bun.file(pngPath);
  if (!(await pngFile.exists())) {
    return [commandResult(false, "", "Scan failed without output", 1), null];
  }

  if (fmt === "png") {
    return publish(pngPath);
  }

  try {
    opts.control?.setProgress?.("Converting scan");
    if (fmt === "jpg" || fmt === "jpeg") {
      const outPath = `${outputDir}/.scan_${stamp}.jpg`;
      const img = (Bun.file(pngPath) as any).image();
      await img.jpeg({ quality: jpegQualityForDpi(dpi) }).write(outPath);
      safeUnlink(pngPath);
      return publish(outPath);
    } else {
      const outPath = `${outputDir}/.scan_${stamp}.pdf`;
      const pngBytes = await Bun.file(pngPath).arrayBuffer();
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([595.28, 841.89]);
      let image;
      try {
        image = await pdfDoc.embedPng(pngBytes);
      } catch {
        const tmpJpg = `${outputDir}/.tmp_${stamp}.jpg`;
        const img = new (Bun as any).Image(pngBytes);
        await img.jpeg({ quality: jpegQualityForDpi(dpi) }).write(tmpJpg);
        const jpgBytes = await Bun.file(tmpJpg).arrayBuffer();
        image = await pdfDoc.embedJpg(jpgBytes);
        safeUnlink(tmpJpg);
      }
      const { width, height } = image.scale(1);
      // DPI-correct display size: pixels -> points at target dpi
      const displayW = (width * 72) / dpi;
      const displayH = (height * 72) / dpi;
      // If embed gave points already shrunk (pdf-lib sometimes returns points at 72dpi), fallback uses min
      const srcW = Math.min(width, displayW);
      const srcH = Math.min(height, displayH);
      const maxW = page.getWidth() - 20;
      const maxH = page.getHeight() - 20;
      const fit = Math.min(maxW / srcW, maxH / srcH, 1);
      const drawW = srcW * fit;
      const drawH = srcH * fit;
      const x = (page.getWidth() - drawW) / 2;
      const y = (page.getHeight() - drawH) / 2;
      page.drawImage(image, { x, y, width: drawW, height: drawH });
      const pdfBytes = await pdfDoc.save();
      await Bun.write(outPath, pdfBytes);
      safeUnlink(pngPath);
      return publish(outPath);
    }
  } catch (exc: any) {
    safeUnlink(pngPath);
    safeUnlink(`${outputDir}/.scan_${stamp}.jpg`);
    safeUnlink(`${outputDir}/.scan_${stamp}.pdf`);
    safeUnlink(`${outputDir}/.tmp_${stamp}.jpg`);
    return [commandResult(false, "", `Could not convert the scan to ${fmt.toUpperCase()}: ${exc}`), null];
  }
}
