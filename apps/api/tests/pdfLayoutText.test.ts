import { describe, expect, it } from "vitest";
import { groupWordsIntoLines, linesToText, type PageBox } from "../src/services/pdfLayoutText.js";

describe("pdf layout text", () => {
  it("orders two-column page regions by column instead of y interleaving", () => {
    const page: PageBox = {
      width: 600,
      height: 800,
      words: [
        { text: "Left", xMin: 50, xMax: 80, yMin: 100, yMax: 110 },
        { text: "one", xMin: 84, xMax: 110, yMin: 100, yMax: 110 },
        { text: "Right", xMin: 340, xMax: 380, yMin: 102, yMax: 112 },
        { text: "one", xMin: 384, xMax: 410, yMin: 102, yMax: 112 },
        { text: "Left", xMin: 50, xMax: 80, yMin: 130, yMax: 140 },
        { text: "two", xMin: 84, xMax: 110, yMin: 130, yMax: 140 },
        { text: "Right", xMin: 340, xMax: 380, yMin: 132, yMax: 142 },
        { text: "two", xMin: 384, xMax: 410, yMin: 132, yMax: 142 },
        { text: "Left", xMin: 50, xMax: 80, yMin: 160, yMax: 170 },
        { text: "three", xMin: 84, xMax: 130, yMin: 160, yMax: 170 },
        { text: "Right", xMin: 340, xMax: 380, yMin: 162, yMax: 172 },
        { text: "three", xMin: 384, xMax: 430, yMin: 162, yMax: 172 },
      ],
    };

    const rendered = linesToText(page, groupWordsIntoLines(page.words));

    expect(rendered.text.indexOf("Left one")).toBeLessThan(rendered.text.indexOf("Right one"));
    expect(rendered.text.indexOf("Left three")).toBeLessThan(rendered.text.indexOf("Right one"));
    expect(rendered.twoColumnBands).toBeGreaterThan(0);
  });
});
