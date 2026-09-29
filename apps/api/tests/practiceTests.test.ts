import { describe, expect, it } from "vitest";
import { parseQuestions } from "../src/scripts/extract-practice-tests.js";

describe("parseQuestions", () => {
  it("drops page-break separator lines instead of appending them to the prompt", () => {
    // Real layout from Practice_Test_4_Questions.txt around a page break.
    const lines = [
      "9. In Washington, who are the main assessors of property values?",
      "",
      "",
      "============================================================",
      "",
      "---",
      "",
      "============================================================",
      "",
      "A. State Department of Revenue",
      "B. State Assessors",
      "",
      "Cc. Municipal Assessors",
      "",
      "D. County Assessors",
    ];

    const question = parseQuestions(lines).get(9);

    expect(question?.prompt).toBe("In Washington, who are the main assessors of property values?");
    expect(question?.options.map((option) => option.text)).toEqual([
      "State Department of Revenue",
      "State Assessors",
      "Municipal Assessors",
      "County Assessors",
    ]);
  });
});
