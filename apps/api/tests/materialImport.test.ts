import "../src/env.js";
import { describe, expect, it } from "vitest";
import { validatedReviewStatus } from "../src/services/materialImport.js";
import type { MaterialQuestion } from "../src/services/materialExtraction.js";

function fixture(overrides: Partial<MaterialQuestion> = {}): MaterialQuestion {
  return {
    id: "fixture",
    question: "Which right applies to rivers?",
    labels: [],
    source: "chapter_question",
    options: [
      { id: "A", text: "Littoral" },
      { id: "B", text: "Riparian" },
      { id: "C", text: "Avulsion" },
      { id: "D", text: "Reliction" },
    ],
    answerLabels: ["B"],
    correctAnswers: [1],
    answerExplanation: "Riparian rights belong to owners of property next to rivers.",
    chapter: { number: null, title: null },
    exam: null,
    subtopic: null,
    subtopicTags: [],
    confidence: 0.85,
    reviewStatus: "ready",
    repairFlags: [],
    repairActions: [],
    rawCandidate: {},
    sourceLocation: { filePath: "fixture.txt", lineStart: 1, lineEnd: 1, sectionTitle: null },
    contentHash: "fixture-hash",
    duplicateOf: null,
    ...overrides,
  } as MaterialQuestion;
}

describe("validatedReviewStatus", () => {
  it("keeps ready status when answers are valid", () => {
    expect(validatedReviewStatus(fixture())).toBe("ready");
  });

  it("keeps auto_repaired status when answers are valid", () => {
    expect(validatedReviewStatus(fixture({ reviewStatus: "auto_repaired" }))).toBe("auto_repaired");
  });

  it("demotes quiz-eligible questions without answers to user review", () => {
    const question = fixture({ answerLabels: [], correctAnswers: [] });
    expect(validatedReviewStatus(question)).toBe("needs_user_review");
  });

  it("demotes quiz-eligible questions whose answer labels do not map to options", () => {
    const question = fixture({ answerLabels: ["B", "Z"], correctAnswers: [1] });
    expect(validatedReviewStatus(question)).toBe("needs_user_review");
  });

  it("demotes quiz-eligible questions whose answer indices fall outside the options", () => {
    const question = fixture({ correctAnswers: [9] });
    expect(validatedReviewStatus(question)).toBe("needs_user_review");
  });

  it("keeps non-eligible statuses unchanged even without answers", () => {
    const question = fixture({ reviewStatus: "needs_user_review", answerLabels: [], correctAnswers: [] });
    expect(validatedReviewStatus(question)).toBe("needs_user_review");
    const repairDebt = fixture({ reviewStatus: "needs_repair", answerLabels: [], correctAnswers: [] });
    expect(validatedReviewStatus(repairDebt)).toBe("needs_repair");
  });
});
