import { describe, expect, it } from "vitest";
import { materialAuditFingerprint } from "../src/services/materialBank.js";
import { applyMaterialRepairs } from "../src/services/materialRepairs.js";
import { materialQuestionFixture } from "./helpers/materialQuestion.js";

const original = () => materialQuestionFixture({
  question: "Which right applies to?",
  reviewStatus: "needs_repair",
  repairFlags: ["model_audit_structure"],
});

function repair(question = original()) {
  return {
    questionId: question.id,
    inputFingerprint: materialAuditFingerprint(question),
    kind: "source_recovery",
    question: "Which water right applies to property alongside a river?",
    options: question.options,
    answerLabels: ["B"],
    answerExplanation: "Riparian rights apply to property alongside a river.",
    evidence: [{ source: "fixture.pdf", locator: "page 2, question 3", quote: "Riparian rights apply to rivers." }],
    note: "Restore the complete stem from the question page.",
  };
}

describe("applyMaterialRepairs", () => {
  it("applies complete content with provenance while preserving the source candidate", () => {
    const question = original();
    const before = structuredClone(question);
    const result = applyMaterialRepairs([question], [repair(question)]);
    expect(question).toEqual(before);
    expect(result.applied).toBe(1);
    expect(result.questions[0]).toMatchObject({
      question: repair().question,
      answerLabels: ["B"],
      correctAnswers: [1],
      reviewStatus: "auto_repaired",
      repairFlags: [],
      rawCandidate: question.rawCandidate,
    });
    expect(result.questions[0].contentHash).not.toBe(question.contentHash);
    expect(result.questions[0].repairActions.at(-1)?.note).toContain("fixture.pdf");
    expect(result.questions[0].repairActions.at(-1)?.note).toContain(materialAuditFingerprint(question));
  });

  it("refuses stale or unmatched repairs instead of changing a different extraction", () => {
    expect(() => applyMaterialRepairs([original()], [{ ...repair(), inputFingerprint: "0".repeat(64) }])).toThrow(/stale/i);
    expect(() => applyMaterialRepairs([original()], [{ ...repair(), questionId: "missing" }])).toThrow(/not found/i);
  });

  it("rejects incomplete content, duplicate options, ambiguous keys, and missing evidence", () => {
    for (const patch of [
      { question: "" },
      { options: repair().options.slice(0, 3) },
      { options: repair().options.map(option => ({ ...option, id: "A" })) },
      { options: repair().options.map(option => ({ ...option, text: "Same choice" })) },
      { answerLabels: ["A", "B"] },
      { evidence: [] },
    ]) {
      expect(() => applyMaterialRepairs([original()], [{ ...repair(), ...patch }])).toThrow();
    }
  });

  it("rejects duplicate repair targets before applying anything", () => {
    expect(() => applyMaterialRepairs([original()], [repair(), repair()])).toThrow(/duplicate/i);
  });

  it("marks substantive AI adaptation as such rather than human verification", () => {
    const result = applyMaterialRepairs([original()], [{ ...repair(), kind: "ai_adaptation" }]);
    expect(result.questions[0].repairActions.at(-1)?.type).toBe("ai_content_repair");
  });

  it("updates classification when a sourced adaptation changes jurisdiction", () => {
    const result = applyMaterialRepairs([original()], [{
      ...repair(), kind: "ai_adaptation",
      chapter: { number: null, title: "State Portion" },
      subtopic: "State", subtopicTags: ["State"], labels: ["State"],
    }]);
    expect(result.questions[0].chapter.title).toBe("State Portion");
    expect(result.questions[0].subtopicTags).toEqual(["State"]);
  });
});
