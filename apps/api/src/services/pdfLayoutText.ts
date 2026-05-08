import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface WordBox {
  text: string;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export interface PageBox {
  width: number;
  height: number;
  words: WordBox[];
}

export interface LineBox {
  text: string;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  yMid: number;
}

interface ColumnBand {
  yMin: number;
  yMax: number;
  gutterStart: number;
  gutterEnd: number;
  isTwoColumn: boolean;
}

interface ColumnZone {
  gutterStart: number;
  gutterEnd: number;
  isTwoColumn: boolean;
}

export interface PdfLayoutTextResult {
  text: string;
  diagnostics: {
    pages: number;
    twoColumnBands: number;
    singleColumnBands: number;
    ambiguousLines: number;
  };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

function parseBboxHtml(html: string): PageBox[] {
  const pages: PageBox[] = [];
  const pagePattern = /<page width="([^"]+)" height="([^"]+)">([\s\S]*?)<\/page>/g;
  let pageMatch: RegExpExecArray | null;

  while ((pageMatch = pagePattern.exec(html))) {
    const words: WordBox[] = [];
    const wordPattern = /<word xMin="([^"]+)" yMin="([^"]+)" xMax="([^"]+)" yMax="([^"]+)">([\s\S]*?)<\/word>/g;
    let wordMatch: RegExpExecArray | null;
    while ((wordMatch = wordPattern.exec(pageMatch[3]))) {
      const text = decodeEntities(wordMatch[5]).trim();
      if (!text) continue;
      words.push({
        text,
        xMin: Number(wordMatch[1]),
        yMin: Number(wordMatch[2]),
        xMax: Number(wordMatch[3]),
        yMax: Number(wordMatch[4]),
      });
    }
    pages.push({
      width: Number(pageMatch[1]),
      height: Number(pageMatch[2]),
      words,
    });
  }

  return pages;
}

export function groupWordsIntoLines(words: WordBox[]): LineBox[] {
  const sorted = [...words].sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin);
  const lines: WordBox[][] = [];

  for (const word of sorted) {
    const yMid = (word.yMin + word.yMax) / 2;
    const existing = lines.find((line) => {
      const first = line[0];
      const lineMid = (first.yMin + first.yMax) / 2;
      const lineHeight = Math.max(8, first.yMax - first.yMin);
      return Math.abs(lineMid - yMid) <= lineHeight * 0.55;
    });
    if (existing) existing.push(word);
    else lines.push([word]);
  }

  return lines
    .flatMap((line) => {
      const ordered = line.sort((a, b) => a.xMin - b.xMin);
      const splitGap = lineGapThreshold(ordered);
      const segments: WordBox[][] = [];
      for (const word of ordered) {
        const current = segments[segments.length - 1];
        const previous = current?.[current.length - 1];
        if (previous && word.xMin - previous.xMax > splitGap) {
          segments.push([word]);
        } else if (current) {
          current.push(word);
        } else {
          segments.push([word]);
        }
      }
      return segments.map((segment) => {
      return {
        text: segment.map((word) => word.text).join(" ").replace(/\s+/g, " ").trim(),
        xMin: Math.min(...segment.map((word) => word.xMin)),
        yMin: Math.min(...segment.map((word) => word.yMin)),
        xMax: Math.max(...segment.map((word) => word.xMax)),
        yMax: Math.max(...segment.map((word) => word.yMax)),
        yMid: segment.reduce((sum, word) => sum + (word.yMin + word.yMax) / 2, 0) / segment.length,
      };
      });
    })
    .filter((line) => line.text.length > 0)
    .sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function lineGapThreshold(words: WordBox[]): number {
  const gaps: number[] = [];
  for (let index = 1; index < words.length; index += 1) {
    const gap = words[index].xMin - words[index - 1].xMax;
    if (gap > 0) gaps.push(gap);
  }
  const typicalGap = median(gaps.filter((gap) => gap < 20));
  return Math.max(24, typicalGap * 8);
}

function estimateSkewSlope(lines: LineBox[], page: PageBox): number {
  const bodyLines = lines.filter((line) =>
    line.yMid > page.height * 0.08 &&
    line.yMid < page.height * 0.92 &&
    line.xMin > page.width * 0.03 &&
    line.xMin < page.width * 0.45
  );
  if (bodyLines.length < 8) return 0;
  const byY = [...bodyLines].sort((a, b) => a.yMid - b.yMid);
  const top = byY.slice(0, Math.max(4, Math.floor(byY.length * 0.25)));
  const bottom = byY.slice(-Math.max(4, Math.floor(byY.length * 0.25)));
  const yDelta = median(bottom.map((line) => line.yMid)) - median(top.map((line) => line.yMid));
  if (Math.abs(yDelta) < 1) return 0;
  const slope = (median(bottom.map((line) => line.xMin)) - median(top.map((line) => line.xMin))) / yDelta;
  return Math.abs(slope) > 0.15 ? 0 : slope;
}

function correctedX(line: LineBox, slope: number): number {
  return line.xMin - slope * line.yMid;
}

function detectBand(lines: LineBox[], page: PageBox, yMin: number, yMax: number, slope: number): ColumnBand {
  const bodyLines = lines.filter((line) =>
    line.yMid >= yMin &&
    line.yMid < yMax &&
    line.xMax - line.xMin < page.width * 0.72 &&
    line.text.length > 1
  );
  const middleStart = page.width * 0.30;
  const middleEnd = page.width * 0.70;
  const leftLines = bodyLines.filter((line) => correctedX(line, slope) < page.width * 0.45);
  const rightLines = bodyLines.filter((line) => correctedX(line, slope) > page.width * 0.45);
  if (leftLines.length >= 3 && rightLines.length >= 3) {
    const leftEdge = median(leftLines.map((line) => line.xMax - slope * line.yMid));
    const rightEdge = median(rightLines.map((line) => line.xMin - slope * line.yMid));
    if (rightEdge - leftEdge > page.width * 0.08) {
      return {
        yMin,
        yMax,
        gutterStart: leftEdge,
        gutterEnd: rightEdge,
        isTwoColumn: true,
      };
    }
  }

  const xValues = bodyLines
    .map((line) => correctedX(line, slope))
    .filter((x) => x >= middleStart && x <= middleEnd)
    .sort((a, b) => a - b);

  let bestGap = 0;
  let gapCenter = page.width / 2;
  for (let index = 1; index < xValues.length; index += 1) {
    const gap = xValues[index] - xValues[index - 1];
    const center = (xValues[index] + xValues[index - 1]) / 2;
    if (gap > bestGap && center > middleStart && center < middleEnd) {
      bestGap = gap;
      gapCenter = center;
    }
  }

  const leftCount = bodyLines.filter((line) => correctedX(line, slope) < gapCenter - page.width * 0.04).length;
  const rightCount = bodyLines.filter((line) => correctedX(line, slope) > gapCenter + page.width * 0.04).length;
  const isTwoColumn = bestGap > page.width * 0.08 && leftCount >= 3 && rightCount >= 3;

  return {
    yMin,
    yMax,
    gutterStart: gapCenter - Math.max(bestGap / 2, page.width * 0.035),
    gutterEnd: gapCenter + Math.max(bestGap / 2, page.width * 0.035),
    isTwoColumn,
  };
}

function detectBands(lines: LineBox[], page: PageBox, slope: number): ColumnBand[] {
  const top = page.height * 0.06;
  const bottom = page.height * 0.94;
  const bandHeight = (bottom - top) / 5;
  return Array.from({ length: 5 }, (_, index) =>
    detectBand(lines, page, top + index * bandHeight, top + (index + 1) * bandHeight, slope)
  );
}

function detectPageZone(lines: LineBox[], page: PageBox, slope: number): ColumnZone {
  const bodyLines = lines.filter((line) =>
    line.yMid > page.height * 0.08 &&
    line.yMid < page.height * 0.94 &&
    line.xMax - line.xMin < page.width * 0.72
  );
  const leftLines = bodyLines.filter((line) => correctedX(line, slope) < page.width * 0.45);
  const rightLines = bodyLines.filter((line) => correctedX(line, slope) > page.width * 0.45);
  if (leftLines.length >= 8 && rightLines.length >= 8) {
    const leftEdge = median(leftLines.map((line) => line.xMax - slope * line.yMid));
    const rightEdge = median(rightLines.map((line) => line.xMin - slope * line.yMid));
    if (rightEdge - leftEdge > page.width * 0.06) {
      return { gutterStart: leftEdge, gutterEnd: rightEdge, isTwoColumn: true };
    }
  }

  return {
    gutterStart: page.width / 2 - page.width * 0.04,
    gutterEnd: page.width / 2 + page.width * 0.04,
    isTwoColumn: false,
  };
}

function bandForLine(bands: ColumnBand[], line: LineBox): ColumnBand {
  return bands.find((band) => line.yMid >= band.yMin && line.yMid < band.yMax) || bands[bands.length - 1];
}

function lineColumn(line: LineBox, band: ColumnBand, page: PageBox, slope: number): "left" | "right" | "full" | "single" | "ambiguous" {
  if (!band.isTwoColumn) return "single";
  if (line.xMax - line.xMin > page.width * 0.62) return "full";
  const x = correctedX(line, slope);
  if (x < band.gutterStart) return "left";
  if (x > band.gutterEnd) return "right";
  return "ambiguous";
}

export function linesToText(page: PageBox, lines: LineBox[]): { text: string; twoColumnBands: number; singleColumnBands: number; ambiguousLines: number } {
  const slope = estimateSkewSlope(lines, page);
  const bands = detectBands(lines, page, slope);
  const pageZone = detectPageZone(lines, page, slope);
  const pageText: string[] = [];
  let ambiguousLines = 0;
  const sortReading = (items: LineBox[]) => items.sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin);

  if (pageZone.isTwoColumn) {
    const headerLines = lines.filter((line) =>
      line.yMid < page.height * 0.10 ||
      line.xMax - line.xMin > page.width * 0.62
    );
    const headerSet = new Set(headerLines);
    const bodyLines = lines.filter((line) => !headerSet.has(line));
    const left: LineBox[] = [];
    const right: LineBox[] = [];
    const ambiguous: LineBox[] = [];

    for (const line of bodyLines) {
      const x = correctedX(line, slope);
      if (x < pageZone.gutterStart) left.push(line);
      else if (x > pageZone.gutterEnd) right.push(line);
      else ambiguous.push(line);
    }

    ambiguousLines += ambiguous.length;
    for (const line of sortReading(headerLines)) pageText.push(line.text);
    if (headerLines.length > 0) pageText.push("");
    for (const line of sortReading(left)) pageText.push(line.text);
    if (left.length > 0) pageText.push("");
    for (const line of sortReading(right)) pageText.push(line.text);
    if (right.length > 0) pageText.push("");
    for (const line of sortReading(ambiguous)) pageText.push(line.text);

    return {
      text: pageText.join("\n"),
      twoColumnBands: Math.max(1, bands.filter((band) => band.isTwoColumn).length),
      singleColumnBands: bands.filter((band) => !band.isTwoColumn).length,
      ambiguousLines,
    };
  }

  for (const band of bands) {
    const bandLines = lines.filter((line) => line.yMid >= band.yMin && line.yMid < band.yMax);
    const full: LineBox[] = [];
    const left: LineBox[] = [];
    const right: LineBox[] = [];
    const single: LineBox[] = [];
    const ambiguous: LineBox[] = [];

    for (const line of bandLines) {
      const column = lineColumn(line, band, page, slope);
      if (column === "left") left.push(line);
      else if (column === "right") right.push(line);
      else if (column === "full") full.push(line);
      else if (column === "ambiguous") ambiguous.push(line);
      else single.push(line);
    }

    ambiguousLines += ambiguous.length;
    const ordered = band.isTwoColumn
      ? [...sortReading(full), ...sortReading(left), ...sortReading(right), ...sortReading(ambiguous)]
      : sortReading([...single, ...full, ...left, ...right, ...ambiguous]);

    for (const line of ordered) pageText.push(line.text);
    if (ordered.length > 0) pageText.push("");
  }

  return {
    text: pageText.join("\n"),
    twoColumnBands: bands.filter((band) => band.isTwoColumn).length,
    singleColumnBands: bands.filter((band) => !band.isTwoColumn).length,
    ambiguousLines,
  };
}

export async function extractPdfLayoutText(pdfPath: string): Promise<PdfLayoutTextResult> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "ai-quiz-pdf-"));
  const bboxPath = path.join(tempDir, "bbox.html");
  try {
    await execFileAsync("pdftotext", ["-bbox", pdfPath, bboxPath], { maxBuffer: 1024 * 1024 * 200 });
    const html = await readFile(bboxPath, "utf8");
    const pages = parseBboxHtml(html);
    const pageTexts: string[] = [];
    let twoColumnBands = 0;
    let singleColumnBands = 0;
    let ambiguousLines = 0;

    pages.forEach((page, index) => {
      const lines = groupWordsIntoLines(page.words);
      const rendered = linesToText(page, lines);
      twoColumnBands += rendered.twoColumnBands;
      singleColumnBands += rendered.singleColumnBands;
      ambiguousLines += rendered.ambiguousLines;
      pageTexts.push(`\n\n[PDF_PAGE ${index + 1}]\n${rendered.text}`);
    });

    return {
      text: pageTexts.join("\n"),
      diagnostics: {
        pages: pages.length,
        twoColumnBands,
        singleColumnBands,
        ambiguousLines,
      },
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
