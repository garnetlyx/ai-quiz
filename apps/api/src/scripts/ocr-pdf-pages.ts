import "../env.js";
import { existsSync } from "fs";
import { mkdir, readFile, readdir, writeFile } from "fs/promises";
import path from "path";
import { joinOcrPages, ocrPdfPage } from "../services/ocr.js";

const DEFAULT_PDF_DIR = "data/wa-agent/pdf";
const DEFAULT_OUTPUT_DIR = "data/wa-agent/ocr";

function repoRoot(): string {
  return path.resolve(process.cwd(), "../..");
}

function getArg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

// pdfinfo is part of poppler, which the OCR path already needs for pdftoppm.
async function pageCount(pdfPath: string): Promise<number> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { stdout } = await promisify(execFile)("pdfinfo", [pdfPath]);
  const match = stdout.match(/^Pages:\s+(\d+)/m);
  if (!match) throw new Error(`Cannot read the page count of ${pdfPath}`);
  return Number(match[1]);
}

// OCRs every page of every PDF with the column-aware reader and writes one
// text file per book (pages behind [PDF_PAGE n] markers) for the extractor.
// Finished pages are cached, so an interrupted run resumes where it stopped.
async function main() {
  const pdfDir = path.resolve(repoRoot(), getArg("pdf-dir") || DEFAULT_PDF_DIR);
  const outputDir = path.resolve(repoRoot(), getArg("output-dir") || DEFAULT_OUTPUT_DIR);
  const concurrency = Number(getArg("concurrency") || 3);
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) throw new Error("concurrency must be a positive integer");
  await mkdir(outputDir, { recursive: true });

  const pdfs = (await readdir(pdfDir)).filter((file) => file.toLowerCase().endsWith(".pdf")).sort();
  for (const pdf of pdfs) {
    const book = pdf.replace(/\.pdf$/i, "");
    const pageDir = path.join(outputDir, book);
    await mkdir(pageDir, { recursive: true });
    const pages = await pageCount(path.join(pdfDir, pdf));
    const todo = Array.from({ length: pages }, (_, index) => index + 1)
      .filter((page) => !existsSync(path.join(pageDir, `${String(page).padStart(3, "0")}.txt`)));
    console.error(`[ocr] ${pdf}: ${pages} pages, ${todo.length} to read`);

    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const page = todo[next++];
        const text = await ocrPdfPage(path.join(pdfDir, pdf), page);
        await writeFile(path.join(pageDir, `${String(page).padStart(3, "0")}.txt`), text);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));

    const texts = await Promise.all(Array.from({ length: pages }, (_, index) =>
      readFile(path.join(pageDir, `${String(index + 1).padStart(3, "0")}.txt`), "utf8")));
    const sourcePath = `${path.relative(repoRoot(), pdfDir)}/${pdf}`;
    await writeFile(path.join(outputDir, `${book}.txt`), joinOcrPages(sourcePath, texts));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
