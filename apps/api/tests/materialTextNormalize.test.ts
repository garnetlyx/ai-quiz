import "../src/env.js";
import { describe, expect, it } from "vitest";
import {
  buildTextVocabulary,
  normalizeBankText,
  normalizeQuestionText,
} from "../src/services/materialTextNormalize.js";
import { materialQuestionFixture } from "./helpers/materialQuestion.js";

// Plain-text sources are intact; PDF sources carry the OCR damage under test.
const intact = (question: string, options: string[], explanation = "") =>
  materialQuestionFixture({
    question,
    options: options.map((text, i) => ({ id: "ABCD"[i] as "A", text })),
    answerExplanation: explanation,
    sourceLocation: { filePath: "data/wa-agent/4-exams/Practice_Test_1_Questions.txt", lineStart: 1, lineEnd: 1, sectionTitle: null },
  });

const corpus = [
  intact("The broker works for a firm that is defined by license law and finalizes the office filing.", ["first", "final", "office", "fixture"],
    "A listing agent owes duties. The property manager reviews the real estate listing, the home, the deed, and the seller. Influenced by the market, the profit is significant and qualified. Financing is fixed. Apartment, agent, another."),
  intact("A listing agent presents the property to a seller and a buyer about the home and a deed to the loan.", ["listing", "property", "seller", "deed"],
    "The property, the home, the loan, the seller, the deed, the listing and the real estate listing. A firm is defined by law. The final office was first. Influenced by rates."),
  intact("The property listing and the home loan and the deed from the seller go to the closing. The agent and the apartment.", ["real", "listing", "property", "seller"],
    "A firm, the final offer, the first offer, the main office, a defined term."),
];

describe("normalizeQuestionText", () => {
  const vocabulary = buildTextVocabulary(corpus);

  it("maps fullwidth punctuation to ASCII", () => {
    expect(normalizeQuestionText("A quitclaim deed conveys：", vocabulary)).toBe("A quitclaim deed conveys:");
    expect(normalizeQuestionText("pays （if any） later？", vocabulary)).toBe("pays (if any) later?");
  });

  it("strips a stray leading question number", () => {
    expect(normalizeQuestionText("（11. A 17-year-old purchased a house.", vocabulary)).toBe("A 17-year-old purchased a house.");
  });

  it("splits a glued leading article when the rest is a known word", () => {
    expect(normalizeQuestionText("Alisting agent writes an offer", vocabulary)).toBe("A listing agent writes an offer");
    expect(normalizeQuestionText("Aproperty manager bases the budget on:", vocabulary)).toBe("A property manager bases the budget on:");
  });

  it("leaves real words that merely start with A alone", () => {
    expect(normalizeQuestionText("Agent duties include the following", vocabulary)).toBe("Agent duties include the following");
    expect(normalizeQuestionText("Apartment rents rise", vocabulary)).toBe("Apartment rents rise");
  });

  it("restores a dropped fi/fl ligature inside a fragment pair", () => {
    expect(normalizeQuestionText("a loan de ned by law", vocabulary)).toBe("a loan defined by law");
    expect(normalizeQuestionText("a market in uenced by rates", vocabulary)).toBe("a market influenced by rates");
    expect(normalizeQuestionText("manage a branch of ce today", vocabulary)).toBe("manage a branch office today");
  });

  it("restores a dropped ligature at the start of a single token", () => {
    expect(normalizeQuestionText("the rm hired a nal agent and a rst offer", vocabulary)).toBe("the firm hired a final agent and a first offer");
  });

  it("leaves all-caps abbreviations alone", () => {
    const text = "the S 1/2 of the SW 1/4 of the NE 1/4 of Section 4";
    const withFine = buildTextVocabulary([...corpus, intact("A fine fine fine penalty", ["a", "b", "c", "d"])]);
    expect(normalizeQuestionText(text, withFine)).toBe(text);
  });

  it("does not split a leading word whose remainder is itself a damaged token", () => {
    // "rms" is "firms" with the ligature dropped, so "Arms" must not become "A rms".
    const withRms = buildTextVocabulary([
      ...corpus,
      intact("Brokerage firms and licensed firms", ["a", "b", "c", "d"]),
      ...Array.from({ length: 6 }, () => intact("Con rms and rms and rms", ["a", "b", "c", "d"])),
    ]);
    expect(normalizeQuestionText("Arms-length transaction", withRms)).toBe("Arms-length transaction");
  });

  it("does not touch contractions or ordinary adjacent words", () => {
    const text = "we've seen that the seller is in the home of the buyer";
    expect(normalizeQuestionText(text, vocabulary)).toBe(text);
  });
});

describe("normalizeBankText", () => {
  it("normalizes question, options and explanation, and reports how many records changed", () => {
    const damaged = materialQuestionFixture({
      question: "Alisting agent is de ned as：",
      options: [
        { id: "A", text: "a rm" },
        { id: "B", text: "the seller" },
        { id: "C", text: "the buyer" },
        { id: "D", text: "the deed" },
      ],
      answerExplanation: "The agent is in uenced by the listing.",
      sourceLocation: { filePath: "data/wa-agent/pdf/Wa-agent.pdf", lineStart: 1, lineEnd: 1, sectionTitle: null },
    });
    const untouched = materialQuestionFixture({ contentHash: "other", question: "Which deed transfers title?" });

    const result = normalizeBankText([...corpus, damaged, untouched]);
    const repaired = result.questions[corpus.length];

    expect(repaired.question).toBe("A listing agent is defined as:");
    expect(repaired.options[0].text).toBe("a firm");
    expect(repaired.answerExplanation).toBe("The agent is influenced by the listing.");
    expect(result.questions[corpus.length + 1].question).toBe("Which deed transfers title?");
    expect(result.changedCount).toBe(1);
  });
});
