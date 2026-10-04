import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseAnswerKey, parsePracticeTests, parseQuestions } from "../src/scripts/extract-practice-tests.js";

// data/ is gitignored, so a fresh clone has no practice-test files; the
// end-to-end parse below only runs where the source data exists.
const EXAMS_DIR = path.resolve(process.cwd(), "../..", "data/wa-agent/4-exams");

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


describe("practice source recovery", () => {
  it("keeps an option's continuation across blank lines", () => {
    // Practice Test 3, State question 5.
    const question = parseQuestions([
      "5. Every management company must have a(n) who ensures",
      "", "the firm acts in accordance with Washington's real estate laws.",
      "", "A. Senior account manager", "B. Designated broker", "",
      "Cc. Managing agent", "", "D.", "", "Office supervisor",
    ]).get(5);
    expect(question?.prompt).toBe("Every management company must have a(n) who ensures the firm acts in accordance with Washington's real estate laws.");
    expect(question?.options.at(-1)).toEqual({ id: "D", text: "Office supervisor" });
  });

  it("recovers missing punctuation on labels without swallowing the option", () => {
    // Practice Test 4, State question 12.
    const question = parseQuestions([
      "12. How often does the Washington State Real Estate Commission", "",
      "meet a year?", "", "A. 2 times", "B. 3 times", "Cc 4 times", "D. 5 times",
    ]).get(12);
    expect(question?.options).toEqual([
      { id: "A", text: "2 times" }, { id: "B", text: "3 times" },
      { id: "C", text: "4 times" }, { id: "D", text: "5 times" },
    ]);
  });

  it("pairs a detached label column with the following four option texts", () => {
    // Practice Test 4, State question 27.
    const question = parseQuestions([
      "27. What type of hearing by the Real Estate Commission has no", "",
      "witness testimony?", "", "A.", "", "B.", "Cc.", "D.", "",
      "Administrative", "Default summary", "Adjudicative", "Investigative",
    ]).get(27);
    expect(question?.prompt).toBe("What type of hearing by the Real Estate Commission has no witness testimony?");
    expect(question?.options.map((option) => option.text)).toEqual([
      "Administrative", "Default summary", "Adjudicative", "Investigative",
    ]);
  });

  it("reads comma-delimited answer numbers and excludes page separators", () => {
    // Practice Test 2, National answer key.
    const answers = parseAnswerKey([
      "42, A) Colleges", "", "Universities and schools are exempt.",
      "============================================================", "---",
      "43. A) Accountability", "44, C) Eminent domain",
    ]);
    expect(answers.get(42)).toEqual({ number: 42, label: "A", explanation: "Colleges Universities and schools are exempt." });
    expect(answers.get(44)?.label).toBe("C");
  });

  it("does not invent an answer for an explicitly invalid source question", () => {
    const answers = parseAnswerKey([
      '25. [QUESTION HAS NO VALID ANSWER — "Fee value appraisal" is not a WA term]',
    ]);
    expect(answers.get(25)?.label).toBeNull();
  });
});


describe("question boundary recovery", () => {
  it("does not parse an article in a wrapped stem as an option label", () => {
    // Practice Test 1, National question 61.
    const question = parseQuestions([
      "61. What is the name of an agreement that allows for conditions on",
      "a property?", "A. Covenant", "B. Lease", "C. Deed", "D. Title",
    ]).get(61);
    expect(question?.prompt).toBe("What is the name of an agreement that allows for conditions on a property?");
    expect(question?.options[0].text).toBe("Covenant");
  });

  it("recognizes a numbered question without a space after its period", () => {
    // Practice Test 2, National question 90.
    const questions = parseQuestions([
      "89. Which of the following is not a physical characteristic of land?",
      "A. Immobility", "B. Indestructibility", "C. Uniqueness", "D. Scarcity",
      "90.A is personal property that is used in a business and can be",
      "removed by the tenant when the lease ends.",
      "A. Trade fixture", "B. Emblement", "C. Easement", "D. License",
    ]);
    expect(questions.size).toBe(2);
    expect(questions.get(90)?.prompt).toBe("A is personal property that is used in a business and can be removed by the tenant when the lease ends.");
    expect(questions.get(89)?.options.at(-1)?.text).toBe("Scarcity");
  });
});


it.skipIf(!existsSync(EXAMS_DIR))("recovers all source question numbers without fabricating absent content", async () => {
  const questions = await parsePracticeTests();
  expect(questions).toHaveLength(520);
  expect(questions.find((question) => question.id === "pt-4-national-31")?.options)
    .toHaveLength(3);
  expect(questions.find((question) => question.id === "pt-3-state-25")?.answerLabels)
    .toEqual([]);
});
