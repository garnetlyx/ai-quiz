import { execFile } from "child_process";
import { promisify } from "util";
import { hasUsableTextLayer, isOcrFallbackEnabled, ocrPdfPage } from "./ocr.js";

const execFileAsync = promisify(execFile);

export interface PdfLayoutTextResult {
  text: string;
  diagnostics: {
    pages: number;
    twoColumnBands: number;
    singleColumnBands: number;
    ambiguousLines: number;
  };
}

export interface LayoutPageResult {
  text: string;
  isTwoColumn: boolean;
  ambiguousLines: number;
}

interface Gutter {
  start: number;
  end: number;
}

/**
 * Detect the column gutter in a two-column page by finding a contiguous band
 * of character columns (within 30%-70% of the page width) that are whitespace
 * on most lines. Returns null when no reliable gutter exists.
 */
function detectGutter(lines: string[]): Gutter | null {
  const useful = lines.map((line) => line.replace(/\s+$/, "")).filter((line) => line.trim().length > 0);
  if (useful.length < 6) return null;

  const maxWidth = useful.reduce((max, line) => (line.length > max ? line.length : max), 0);
  if (maxWidth < 20) return null;

  const lo = Math.floor(maxWidth * 0.3);
  const hi = Math.ceil(maxWidth * 0.7);
  const threshold = useful.length * 0.45;

  const colSpaces = new Int32Array(maxWidth + 1);
  for (const line of useful) {
    for (let c = lo; c <= hi && c < line.length; c += 1) {
      if (line.charCodeAt(c) === 32) colSpaces[c] += 1;
    }
  }

  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  for (let c = lo; c <= hi; c += 1) {
    const inGutter = colSpaces[c] >= threshold;
    if (inGutter) {
      if (curStart < 0) curStart = c;
    } else if (curStart >= 0) {
      const len = c - curStart;
      if (len > bestLen) {
        bestLen = len;
        bestStart = curStart;
      }
      curStart = -1;
    }
  }
  if (curStart >= 0) {
    const len = hi + 1 - curStart;
    if (len > bestLen) {
      bestLen = len;
      bestStart = curStart;
    }
  }

  if (bestStart < 0 || bestLen < 3) return null;
  return { start: bestStart, end: bestStart + bestLen };
}

/**
 * Split a single physical line into [left, right] column segments at the longest
 * run of spaces overlapping the gutter. Returns null when no split is possible.
 */
function splitAtGutter(line: string, gutter: Gutter): [string, string] | null {
  const lo = Math.max(0, gutter.start - 2);
  const hi = Math.min(line.length, gutter.end + 2);
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  for (let c = lo; c <= hi; c += 1) {
    const isSpace = c < line.length && line.charCodeAt(c) === 32;
    if (isSpace) {
      if (curStart < 0) curStart = c;
    } else if (curStart >= 0) {
      const len = c - curStart;
      if (len > bestLen) {
        bestLen = len;
        bestStart = curStart;
      }
      curStart = -1;
    }
  }
  if (curStart >= 0) {
    const len = hi - curStart;
    if (len > bestLen) {
      bestLen = len;
      bestStart = curStart;
    }
  }
  if (bestLen < 3) return null;

  const left = line.slice(0, bestStart).trim();
  const right = line.slice(bestStart + bestLen).trim();
  if (!left || !right) return null;
  return [left, right];
}

/**
 * Reorder a single page of `pdftotext -layout` output into column-major reading
 * order: headers → all left-column segments (top to bottom) → all right-column
 * segments → footers. Single-column pages are returned unchanged.
 */
export function parseLayoutColumns(rawPage: string): LayoutPageResult {
  const lines = rawPage.split("\n").map((line) => line.replace(/\r$/, ""));
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  const gutter = detectGutter(nonEmpty);

  if (!gutter) {
    return { text: nonEmpty.join("\n"), isTwoColumn: false, ambiguousLines: 0 };
  }

  const left: string[] = [];
  const right: string[] = [];
  const fullByPos: { idx: number; text: string }[] = [];
  let splittable = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim().length === 0) continue;

    const split = splitAtGutter(line, gutter);
    if (split) {
      left.push(split[0]);
      right.push(split[1]);
      splittable += 1;
      continue;
    }

    const trimmed = line.trim();
    const hasLeft = line.slice(0, gutter.start).trim().length > 0;
    const hasRight = line.slice(gutter.end).trim().length > 0;
    if (hasLeft && hasRight) {
      fullByPos.push({ idx: i, text: trimmed });
    } else if (hasRight) {
      right.push(trimmed);
    } else {
      left.push(trimmed);
    }
  }

  if (splittable < 3) {
    return { text: nonEmpty.join("\n"), isTwoColumn: false, ambiguousLines: 0 };
  }

  const midIndex = lines.length / 2;
  const headers = fullByPos.filter((item) => item.idx < midIndex).map((item) => item.text);
  const footers = fullByPos.filter((item) => item.idx >= midIndex).map((item) => item.text);
  const out = [...headers, ...left, ...right, ...footers];
  return { text: out.join("\n"), isTwoColumn: true, ambiguousLines: 0 };
}

export async function extractPdfLayoutText(pdfPath: string): Promise<PdfLayoutTextResult> {
  const { stdout } = await execFileAsync("pdftotext", ["-layout", pdfPath, "-"], {
    maxBuffer: 1024 * 1024 * 200,
  });

  const rawPages = stdout.split("\f");
  if (rawPages.length > 0 && rawPages[rawPages.length - 1] === "") {
    rawPages.pop();
  }

  const pageTexts: string[] = [];
  let twoColumnBands = 0;
  let singleColumnBands = 0;
  let ambiguousLines = 0;

  for (let index = 0; index < rawPages.length; index += 1) {
    const rawPage = rawPages[index];
    let pageText = rawPage;
    let viaOcr = false;

    // Fallback to OCR when the page has no usable text layer (scanned page).
    if (isOcrFallbackEnabled() && !hasUsableTextLayer(rawPage)) {
      try {
        const ocrText = await ocrPdfPage(pdfPath, index + 1);
        if (ocrText.trim().length > 0) {
          pageText = ocrText;
          viaOcr = true;
        }
      } catch {
        // OCR failure is non-fatal; keep the empty text-layer output.
      }
    }

    const rendered = viaOcr ? { text: pageText, isTwoColumn: false, ambiguousLines: 0 } : parseLayoutColumns(rawPage);
    if (rendered.isTwoColumn) twoColumnBands += 1;
    else singleColumnBands += 1;
    ambiguousLines += rendered.ambiguousLines;
    pageTexts.push(`\n\n[PDF_PAGE ${index + 1}]\n${rendered.text}`);
  }

  return {
    text: pageTexts.join("\n"),
    diagnostics: {
      pages: rawPages.length,
      twoColumnBands,
      singleColumnBands,
      ambiguousLines,
    },
  };
}
