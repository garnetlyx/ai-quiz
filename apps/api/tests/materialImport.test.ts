import "../src/env.js";
import { describe, expect, it } from "vitest";
import { validatedReviewStatus } from "../src/services/materialImport.js";
import { materialQuestionFixture } from "./helpers/materialQuestion.js";

function fixture(overrides = {}) {
  return materialQuestionFixture(overrides);
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
