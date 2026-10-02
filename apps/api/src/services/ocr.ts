/**
 * OCR fallback for PDF pages and images without a usable text layer.
 *
 * Two engines, selected by config:
 *  - tesseract (default, local, free): TSV output with word bounding boxes,
 *    reordered into column-major reading order for two-column layouts.
 *  - LLM vision (opt-in advanced): sends the rendered page image to a
 *    multimodal chat model and asks for text in reading order. Higher
 *    quality on noisy scans, but costs a model round-trip per page.
 *
 * The chain is: pdftoppm renders the page → tesseract TSV → reorder → text.
 * When `OCR_LLM_ENABLED` is on, the LLM path replaces tesseract for pages
 * whose tesseract output looks structurally broken.
 */
import { execFile } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

export interface OcrWordBox {
  sourceLine: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  text: string;
}

export interface OcrOptions {
  /** Render DPI for pdftoppm. Default 300. */
  dpi?: number;
  /** tesseract page segmentation mode. Default 3 (fully automatic). */
  psm?: number;
  /** Force the LLM vision path even when tesseract succeeds. */
  forceLLM?: boolean;
}

const DEFAULT_DPI = 300;
const DEFAULT_PSM = 3;

/** A page is considered to have no usable text layer when shorter than this. */
export const TEXT_LAYER_MIN_CHARS = 50;

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "true" || raw === "1" || raw === "yes";
}

/** Whether OCR fallback is enabled at all. Default true for testing. */
export function isOcrFallbackEnabled(): boolean {
  return bool("OCR_FALLBACK_ENABLED", true);
}

/** Whether the LLM vision path is enabled (the "advanced feature"). Default true now. */
export function isOcrLlmEnabled(): boolean {
  return bool("OCR_LLM_ENABLED", true);
}

function tesseractAvailable(): boolean {
  return bool("OCR_TESSERACT_AVAILABLE", true);
}

function pdftoppmAvailable(): boolean {
  return bool("OCR_PDFTOPPM_AVAILABLE", true);
}

/**
 * Render a single PDF page to a PNG buffer using pdftoppm.
 * pdftoppm cannot reliably stream PNG to stdout, so we spill to a temp
 * file and read it back. Returns the raw PNG bytes.
 */
export async function renderPdfPage(
  pdfPath: string,
  pageNum: number,
  dpi: number = num("OCR_DPI", DEFAULT_DPI)
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "pdfrender-"));
  try {
    const prefix = join(dir, "page");
    await execFileAsync(
      "pdftoppm",
      ["-f", String(pageNum), "-l", String(pageNum), "-r", String(dpi), "-png", pdfPath, prefix],
      { encoding: "buffer", maxBuffer: 1024 * 1024 * 100 }
    );
    // pdftoppm names outputs page-NN.png (zero-padded by page count); find it.
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(dir);
    const png = entries.find((f) => f.endsWith(".png"));
    if (!png) throw new Error(`pdftoppm produced no PNG for page ${pageNum}`);
    return await readFile(join(dir, png));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Run tesseract on an image buffer and return words with bounding boxes.
 * Uses TSV output mode (level 5 = word) for geometry-aware column reorder.
 */
export async function ocrImageTesseract(
  image: Buffer,
  psm: number = num("OCR_TESSERACT_PSM", DEFAULT_PSM)
): Promise<OcrWordBox[]> {
  if (!tesseractAvailable()) return [];
  // tesseract reads files, not stdin; spill to a temp file per call.
  const dir = await mkdtemp(join(tmpdir(), "ocr-"));
  try {
    const imgPath = join(dir, "page.png");
    await writeFile(imgPath, image);
    const { stdout } = await execFileAsync(
      "tesseract",
      [imgPath, "stdout", "--psm", String(psm), "tsv"],
      { encoding: "utf8", maxBuffer: 1024 * 1024 * 50 }
    );
    return parseTsv(stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Parse tesseract TSV output into word boxes (confidence can be a float). */
export function parseTsv(tsv: string): OcrWordBox[] {
  const lines = tsv.split("\n");
  if (lines.length === 0) return [];
  const boxes: OcrWordBox[] = [];
  // Skip header line.
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = line.split("\t");
    if (cols.length < 12) continue;
    const level = Number(cols[0]);
    if (level !== 5) continue; // only word rows
    const conf = Number(cols[10]);
    if (!Number.isFinite(conf) || conf < 0) continue;
    const text = cols[11];
    if (!text || !text.trim()) continue;
    const left = Number(cols[6]);
    const top = Number(cols[7]);
    const width = Number(cols[8]);
    const height = Number(cols[9]);
    if (![left, top, width, height].every(Number.isFinite)) continue;
    boxes.push({
      sourceLine: cols.slice(1, 5).join(":"),
      left, top, right: left + width, bottom: top + height, text: text.trim(),
    });
  }
  return boxes;
}

/**
 * Reorder word boxes into column-major reading order for two-column layouts.
 * Splits by the horizontal midpoint: left column (top→bottom), then right
 * column (top→bottom). Single-column pages naturally pass through since all
 * words cluster on one side.
 */
export function reorderColumnMajor(boxes: OcrWordBox[]): string {
  if (boxes.length === 0) return "";
  if (boxes.length === 1) return boxes[0].text;

  const maxRight = boxes.reduce((m, b) => (b.right > m ? b.right : m), 0);
  if (maxRight === 0) return boxes.map((b) => b.text).join(" ");
  const minLeft = boxes.reduce((m, b) => Math.min(m, b.left), Infinity);
  const mid = (minLeft + maxRight) / 2;

  // Tesseract supplies line identity. Keep whole lines together; splitting
  // individual words at the midpoint truncates long left-column prompts.
  const sourceLines = groupSourceLines(boxes);

  // Only treat as two-column when there is a clear gutter: substantial word
  // mass on both sides of the midpoint.
  const left = sourceLines.filter((line) => Math.min(...line.map((b) => b.left)) < mid).flat();
  const right = sourceLines.filter((line) => Math.min(...line.map((b) => b.left)) >= mid).flat();
  const useTwoColumn = left.length >= 3 && right.length >= 3;

  if (!useTwoColumn) {
    return linesFromBoxes(boxes).join("\n");
  }
  return [...linesFromBoxes(left), ...linesFromBoxes(right)].join("\n");
}

function groupSourceLines(boxes: OcrWordBox[]): OcrWordBox[][] {
  const lines = new Map<string, OcrWordBox[]>();
  for (const box of boxes) {
    const line = lines.get(box.sourceLine) || [];
    line.push(box);
    lines.set(box.sourceLine, line);
  }
  return [...lines.values()].sort((a, b) =>
    Math.min(...a.map((box) => box.top)) - Math.min(...b.map((box) => box.top)) ||
    Math.min(...a.map((box) => box.left)) - Math.min(...b.map((box) => box.left))
  );
}

/** Use source line IDs; y-distance merges tightly spaced question/option lines. */
function linesFromBoxes(boxes: OcrWordBox[]): string[] {
  const lines: OcrWordBox[][] = [];
  for (const fragment of groupSourceLines(boxes)) {
    const previous = lines[lines.length - 1];
    const top = Math.min(...fragment.map((box) => box.top));
    const bottom = Math.max(...fragment.map((box) => box.bottom));
    const previousTop = previous && Math.min(...previous.map((box) => box.top));
    const previousBottom = previous && Math.max(...previous.map((box) => box.bottom));
    // Number/letter labels are sometimes separate Tesseract blocks. Merge
    // only fragments sharing a baseline, never adjacent printed lines.
    if (previous && previousTop !== undefined && previousBottom !== undefined &&
        Math.abs((top + bottom) - (previousTop + previousBottom)) <=
          Math.min(bottom - top, previousBottom - previousTop)) {
      previous.push(...fragment);
    } else {
      lines.push([...fragment]);
    }
  }
  return lines.map((line) =>
    line.sort((a, b) => a.left - b.left).map((b) => b.text).join(" ")
  );
}

const BAND_MIN_ROWS = 4;
const BAND_MIN_TWO_SIDED_ROWS = 3;
const ROW_TOLERANCE_OF_HEIGHT = 0.6;
const GUTTER_HALF_WIDTH_OF_HEIGHT = 0.5;
const GUTTER_MIN_FRACTION_OF_WIDTH = 0.01;

function clusterRows(boxes: OcrWordBox[], tolerance: number): OcrWordBox[][] {
  const sorted = [...boxes].sort((a, b) => (a.top + a.bottom) - (b.top + b.bottom) || a.left - b.left);
  const rows: { words: OcrWordBox[]; center: number }[] = [];
  for (const box of sorted) {
    const center = (box.top + box.bottom) / 2;
    const row = rows[rows.length - 1];
    if (row && Math.abs(center - row.center) <= tolerance) {
      row.words.push(box);
      row.center = (row.center * (row.words.length - 1) + center) / row.words.length;
    } else {
      rows.push({ words: [box], center });
    }
  }
  return rows.map((row) => row.words.sort((a, b) => a.left - b.left));
}

/**
 * Reading order for pages that mix full-width text with two-column bands
 * (a chapter's body text above a two-column "Sample Questions" box). Tesseract
 * merges the two columns of a band into single lines, so the decision is made
 * per horizontal band from word geometry: a run of rows with a clear gutter and
 * text on both sides is read left column then right column; everything else is
 * read top to bottom.
 */
export function reorderBanded(boxes: OcrWordBox[]): string {
  if (boxes.length === 0) return "";
  const heights = boxes.map((box) => box.bottom - box.top).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || 1;
  const tolerance = medianHeight * ROW_TOLERANCE_OF_HEIGHT;
  const minLeft = Math.min(...boxes.map((box) => box.left));
  const maxRight = Math.max(...boxes.map((box) => box.right));
  const mid = (minLeft + maxRight) / 2;
  const zone = Math.max(medianHeight * GUTTER_HALF_WIDTH_OF_HEIGHT, (maxRight - minLeft) * GUTTER_MIN_FRACTION_OF_WIDTH);
  const crossesGutter = (box: OcrWordBox) => box.left < mid + zone && box.right > mid - zone;
  const center = (box: OcrWordBox) => (box.left + box.right) / 2;
  const text = (row: OcrWordBox[]) => row.map((box) => box.text).join(" ");

  const rows = clusterRows(boxes, tolerance).map((row) => ({
    row,
    split: !row.some(crossesGutter),
    twoSided: row.some((box) => center(box) < mid) && row.some((box) => center(box) >= mid),
  }));

  const lines: string[] = [];
  let index = 0;
  while (index < rows.length) {
    if (!rows[index].split) {
      lines.push(text(rows[index].row));
      index += 1;
      continue;
    }
    let end = index;
    while (end < rows.length && rows[end].split) end += 1;
    const run = rows.slice(index, end);
    const isBand = run.length >= BAND_MIN_ROWS && run.filter((entry) => entry.twoSided).length >= BAND_MIN_TWO_SIDED_ROWS;
    if (isBand) {
      const words = run.flatMap((entry) => entry.row);
      const columns = [words.filter((box) => center(box) < mid), words.filter((box) => center(box) >= mid)];
      for (const column of columns) lines.push(...clusterRows(column, tolerance).map(text));
    } else {
      for (const entry of run) lines.push(text(entry.row));
    }
    index = end;
  }
  return lines.join("\n");
}

/** Find an empty central gutter between substantial, non-overlapping columns. */
export function detectOcrColumnSplit(boxes: OcrWordBox[]): number | null {
  const lines = groupSourceLines(boxes).filter((line) =>
    !/^\d+[.]?$/.test(line.map((box) => box.text).join(" "))
  ).map((line) => ({
    left: Math.min(...line.map((box) => box.left)),
    right: Math.max(...line.map((box) => box.right)),
    top: Math.min(...line.map((box) => box.top)),
    bottom: Math.max(...line.map((box) => box.bottom)),
  }));
  if (lines.length < num("OCR_COLUMN_MIN_LINES", 6)) return null;
  // An isolated running header can span both columns; body text cannot.
  if (lines[1].top - lines[0].bottom > (lines[0].bottom - lines[0].top) * 2) lines.shift();
  const left = Math.min(...lines.map((line) => line.left));
  const right = Math.max(...lines.map((line) => line.right));
  const middle = (left + right) / 2;
  const leftLines = lines.filter((line) => line.right < middle);
  const rightLines = lines.filter((line) => line.left > middle);
  const required = Math.ceil(lines.length * num("OCR_COLUMN_MIN_FRACTION", 0.25));
  if (leftLines.length < required || rightLines.length < required) return null;
  // Refuse mixed single-/two-column pages. A crop must never bisect body text.
  if (leftLines.length + rightLines.length !== lines.length) return null;
  const gutterStart = Math.max(...leftLines.map((line) => line.right));
  const gutterEnd = Math.min(...rightLines.map((line) => line.left));
  const heights = lines.map((line) => line.bottom - line.top).sort((a, b) => a - b);
  if (gutterEnd - gutterStart < heights[Math.floor(heights.length / 2)]) return null;
  return Math.round((gutterStart + gutterEnd) / 2);
}

async function readTesseractColumns(image: Buffer, boxes: OcrWordBox[]): Promise<string> {
  const split = detectOcrColumnSplit(boxes);
  // Mixed pages (full-width text plus a two-column band) are read band by band.
  if (split === null) return reorderBanded(boxes);
  const { width, height } = await sharp(image).metadata();
  if (!width || !height || split <= 0 || split >= width) throw new Error("Invalid OCR image geometry");
  const parts: string[] = [];
  for (const crop of [
    { left: 0, top: 0, width: split, height },
    { left: split, top: 0, width: width - split, height },
  ]) {
    const column = await sharp(image).extract(crop).png().toBuffer();
    // Each detected column is one text block. PSM 3 on a whole page can
    // discard answer-label strips as noise (Wa-agent3.pdf, page 14).
    parts.push(linesFromBoxes(await ocrImageTesseract(column, 6)).join("\n"));
  }
  return parts.join("\n");
}

function getLlmModel(): string {
  return (
    process.env.OCR_LLM_MODEL ||
    process.env.MATERIAL_AI_MODEL ||
    process.env.OPENAI_MODEL ||
    "gpt-4o"
  );
}

/**
 * Send the page image to a multimodal LLM and ask for text in column-major
 * reading order. Uses native fetch (not the OpenAI SDK) so the request body
 * is sent verbatim — some proxy routes (e.g. anthropic-messages bridges)
 * mishandle the SDK's image payload serialization.
 */
export async function ocrImageWithLLM(image: Buffer, mimeType = "image/png"): Promise<string> {
  const base64 = image.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;
  const baseURL = process.env.OPENAI_BASE_URL || process.env.MATERIAL_AI_BASE_URL || "https://api.openai.com/v1";
  const apiKey = process.env.OPENAI_API_KEY || process.env.MATERIAL_AI_API_KEY || "dummy";
  const timeoutMs = num("OCR_LLM_TIMEOUT_MS", 120000);
  const maxRetries = num("OCR_LLM_RETRIES", 2);
  const url = `${baseURL.replace(/\/$/, "")}/chat/completions`;
  const body = JSON.stringify({
    model: getLlmModel(),
    temperature: 0,
    max_tokens: 4000,
    messages: [
      {
        role: "system",
        content:
          "You are an OCR engine for textbook pages. Extract ALL text from the image verbatim, " +
          "in correct reading order. For two-column layouts, read the left column top-to-bottom " +
          "completely, then the right column top-to-bottom. Preserve question numbers, option " +
          "letters (A/B/C/D), and punctuation exactly. Output PLAIN TEXT only — no markdown, " +
          "no bold (**), no bullet dashes, no headers. Just the raw text as printed.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Extract the text from this page in column reading order." },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  // Reasoning models (e.g. minimax-m3) can take 10-30s with thinking; use a hard
  // signal timeout and retry transient network failures (ETIMEDOUT/ECONNRESET).
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!resp.ok) {
        throw new Error(`LLM OCR HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      }
      const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content || "";
      return stripReasoningWrapper(content);
    } catch (err) {
      lastErr = err;
      // Only retry on network/timeout errors, not HTTP errors.
      const code = (err as { cause?: { code?: string } }).cause?.code;
      const isNet = code && /[ETIMEDOUT|ECONNRESET|EHOSTUNREACH|EAI_AGAIN|UND_ERR_SOCKET]/.test(code);
      const isAbort = err instanceof Error && err.name === "TimeoutError";
      if (!isNet && !isAbort) break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("LLM OCR failed");
}

/** Strip chain-of-thought wrappers some reasoning models emit (e.g. minimax-m3 <think>…</think>). */
function stripReasoningWrapper(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .trim();
}

/**
 * OCR an image buffer, returning column-major text.
 *
 * Strategy:
 *  1. tesseract TSV + column reorder (always, unless forceLLM)
 *  2. If tesseract output is thin AND LLM enabled, retry with LLM vision
 *  3. forceLLM skips tesseract entirely
 */
export async function ocrImage(
  image: Buffer,
  opts: OcrOptions = {}
): Promise<string> {
  const forceLLM = opts.forceLLM ?? false;
  const llmEnabled = isOcrLlmEnabled();

  if (forceLLM || llmEnabled) {
    try {
      return await ocrImageWithLLM(image);
    } catch (err) {
      if (forceLLM) throw err;
      // fall through to tesseract
    }
  }

  if (!tesseractAvailable()) return "";
  const boxes = await ocrImageTesseract(image, opts.psm);
  return readTesseractColumns(image, boxes);
}

/**
 * Render and OCR a single PDF page. Used by extractPdfLayoutText as a
 * fallback when the page has no usable text layer.
 */
export async function ocrPdfPage(
  pdfPath: string,
  pageNum: number,
  opts: OcrOptions = {}
): Promise<string> {
  if (!pdftoppmAvailable()) return "";
  const image = await renderPdfPage(pdfPath, pageNum, opts.dpi);
  return ocrImage(image, opts);
}

/**
 * Join per-page OCR text in the layout-text format the question extractor reads:
 * a source line, then each page behind a [PDF_PAGE n] marker.
 */
export function joinOcrPages(sourcePath: string, pageTexts: string[]): string {
  return `[PDF_SOURCE ${sourcePath}]` + pageTexts.map((text, index) => `\n\n[PDF_PAGE ${index + 1}]\n${text}`).join("");
}

/** Heuristic: does this page text look too thin to skip OCR? */
export function hasUsableTextLayer(pageText: string): boolean {
  return pageText.replace(/\s/g, "").length >= TEXT_LAYER_MIN_CHARS;
}

/**
 * Detect MIME type for a file path by extension (used by the LLM image path).
 */
export function mimeTypeForPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".tiff") || lower.endsWith(".tif")) return "image/tiff";
  return "image/png";
}

/**
 * OCR an image file from disk (used by materialImport for uploaded images).
 */
export async function ocrImageFile(filePath: string, opts: OcrOptions = {}): Promise<string> {
  const image = await readFile(filePath);
  // LLM path needs the correct MIME type; tesseract infers from file content.
  if (isOcrLlmEnabled() || opts.forceLLM) {
    try {
      return await ocrImageWithLLM(image, mimeTypeForPath(filePath));
    } catch {
      // fall through to tesseract
    }
  }
  if (!tesseractAvailable()) return "";
  const boxes = await ocrImageTesseract(image, opts.psm);
  return reorderColumnMajor(boxes);
}

// readFile is imported at top; this avoids a circular re-import quirk.
