import { describe, expect, it } from "vitest";
import { detectOcrColumnSplit, parseTsv, reorderColumnMajor } from "../src/services/ocr.js";

const header = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";

describe("Tesseract source extraction", () => {
  it("crops only a clear body gutter and refuses mixed or single-column text", () => {
    const rows = Array.from({ length: 8 }, (_, index) => [
      `5\t1\t1\t1\t${index + 1}\t1\t100\t${100 + index * 20}\t350\t12\t96\tLeft text`,
      `5\t1\t2\t1\t${index + 1}\t1\t550\t${100 + index * 20}\t350\t12\t96\tRight text`,
    ]).flat();
    expect(detectOcrColumnSplit(parseTsv([header, ...rows].join("\n")))).toBe(500);
    const spanningBody = "5\t1\t3\t1\t1\t1\t100\t130\t800\t12\t96\tSpanning body";
    expect(detectOcrColumnSplit(parseTsv([header, ...rows, spanningBody].join("\n")))).toBeNull();
    expect(detectOcrColumnSplit(parseTsv([header, ...rows.filter((_, i) => i % 2 === 0)].join("\n")))).toBeNull();
  });

  it("uses the word-level column rather than retaining only fifth lines", () => {
    // Schema and first row are from tesseract's TSV for Wa-agent3.pdf page 7.
    const tsv = [header,
      "4\t1\t1\t1\t1\t0\t115\t47\t436\t19\t-1\t",
      "5\t1\t1\t1\t1\t1\t115\t52\t62\t12\t65.092377\tInsider's",
      "5\t1\t1\t1\t2\t1\t115\t72\t62\t12\t96\tFirst",
      "5\t1\t1\t1\t5\t1\t115\t132\t62\t12\t96\tFifth",
    ].join("\n");
    expect(parseTsv(tsv).map((word) => word.text)).toEqual(["Insider's", "First", "Fifth"]);
  });

  it("preserves adjacent source lines and keeps each line inside its column", () => {
    const tsv = [header,
      "5\t1\t1\t1\t1\t1\t100\t100\t100\t12\t96\tQuestion",
      "5\t1\t1\t1\t1\t2\t460\t100\t60\t12\t96\ttail",
      "5\t1\t1\t1\t2\t1\t100\t116\t100\t12\t96\tA.",
      "5\t1\t1\t1\t2\t2\t220\t116\t100\t12\t96\tchoice",
      "5\t1\t1\t1\t3\t1\t100\t132\t100\t12\t96\tB.",
      "5\t1\t2\t1\t1\t1\t560\t100\t100\t12\t96\tNext",
      "5\t1\t2\t1\t1\t2\t800\t100\t160\t12\t96\tquestion",
      "5\t1\t2\t1\t2\t1\t560\t116\t100\t12\t96\tA.",
    ].join("\n");
    expect(reorderColumnMajor(parseTsv(tsv))).toBe("Question tail\nA. choice\nB.\nNext question\nA.");
  });

  it("joins question numbers in separate OCR blocks on the same baseline", () => {
    const tsv = [header,
      "5\t1\t1\t1\t1\t1\t100\t102\t20\t12\t96\t74.",
      "5\t1\t2\t1\t1\t1\t140\t100\t100\t12\t96\tQuestion",
      "5\t1\t2\t1\t2\t1\t140\t116\t100\t12\t96\tcontinued",
    ].join("\n");
    expect(reorderColumnMajor(parseTsv(tsv))).toBe("74. Question\ncontinued");
  });
});
