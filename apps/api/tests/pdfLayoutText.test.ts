import { describe, expect, it } from "vitest";
import { parseLayoutColumns } from "../src/services/pdfLayoutText.js";

describe("pdf layout text", () => {
  it("reorders two-column layout output into column-major reading order", () => {
    const page = [
      "          Sample Exam",
      "",
      "   1. Left one          5. Right one",
      "      option A            option A",
      "      option B            option B",
      "   2. Left two          6. Right two",
      "      option A            option A",
      "      option B            option B",
      "   3. Left three        7. Right three",
      "      option A            option A",
      "",
      "                                                       42",
    ].join("\n");

    const rendered = parseLayoutColumns(page);

    expect(rendered.isTwoColumn).toBe(true);
    // Header precedes everything.
    expect(rendered.text.indexOf("Sample Exam")).toBe(0);
    // Left column fully precedes right column.
    expect(rendered.text.indexOf("Left one")).toBeLessThan(rendered.text.indexOf("Right one"));
    expect(rendered.text.indexOf("Left three")).toBeLessThan(rendered.text.indexOf("Right one"));
    // Footer (page number) trails the body.
    expect(rendered.text.lastIndexOf("\n42")).toBeGreaterThan(rendered.text.indexOf("Right three"));
  });

  it("leaves single-column pages in original order", () => {
    const page = ["1. First question", "   option A", "   option B", "2. Second question"].join("\n");

    const rendered = parseLayoutColumns(page);

    expect(rendered.isTwoColumn).toBe(false);
    expect(rendered.text).toBe(page);
  });
});
