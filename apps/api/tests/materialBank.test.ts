import "../src/env.js";
import { describe, expect, it } from "vitest";
import {
  applyModelAudit,
  buildScopeFromQuestions,
  materialAuditFingerprint,
  mergeQuestionBanks,
  type MaterialAuditRecord,
} from "../src/services/materialBank.js";
import { materialQuestionFixture } from "./helpers/materialQuestion.js";

describe("mergeQuestionBanks", () => {
  it("keeps the first occurrence of each content hash across banks", () => {
    const first = materialQuestionFixture({ contentHash: "dup" });
    const second = materialQuestionFixture({ contentHash: "dup", question: "Duplicate wording" });
    const unique = materialQuestionFixture({ contentHash: "unique" });

    const merged = mergeQuestionBanks([[first, unique], [second]]);

    expect(merged.questions).toHaveLength(2);
    expect(merged.questions[0].question).toBe("Which right applies to rivers?");
    expect(merged.duplicateCount).toBe(1);
  });
});

describe("buildScopeFromQuestions", () => {
  it("derives chapters from chapter titles ordered by chapter number", () => {
    const later = materialQuestionFixture({ chapter: { number: 5, title: "Contract Law" }, subtopicTags: ["Contract Law"], subtopic: "Contract Law" });
    const earlier = materialQuestionFixture({ chapter: { number: 1, title: "The Nature of Real Property" }, contentHash: "a" });

    const scope = buildScopeFromQuestions([later, earlier]);

    expect(scope.chapters.map((chapter) => chapter.title)).toEqual([
      "The Nature of Real Property",
      "Contract Law",
    ]);
    expect(scope.chapters[0].items).toHaveLength(1);
    expect(scope.chapters[0].items[0].title).toBe("The Nature of Real Property");
  });

  it("falls back to non-source labels for questions without chapters", () => {
    const exam = materialQuestionFixture({
      source: "exam_question",
      chapter: { number: null, title: null },
      subtopic: null,
      subtopicTags: [],
      labels: ["exam_question", "Sample Exam 2"],
      contentHash: "exam",
    });

    const scope = buildScopeFromQuestions([exam]);

    expect(scope.chapters).toHaveLength(1);
    expect(scope.chapters[0].title).toBe("Sample Exam 2");
    expect(scope.chapters[0].items[0].title).toBe("Sample Exam 2");
  });

  it("derives practice test items from subtopic tags", () => {
    const national1 = materialQuestionFixture({
      chapter: { number: null, title: "National Portion" },
      subtopic: "National",
      subtopicTags: ["Practice Test 1", "National"],
      contentHash: "pt1",
    });
    const national2 = materialQuestionFixture({
      chapter: { number: null, title: "National Portion" },
      subtopic: "National",
      subtopicTags: ["Practice Test 2", "National"],
      contentHash: "pt2",
    });

    const scope = buildScopeFromQuestions([national1, national2]);

    expect(scope.chapters).toHaveLength(1);
    expect(scope.chapters[0].title).toBe("National Portion");
    expect(scope.chapters[0].items.map((item) => item.title)).toEqual(["Practice Test 1", "Practice Test 2"]);
  });

  it("groups unlabeled questions into an uncategorized chapter", () => {
    const stray = materialQuestionFixture({
      chapter: { number: null, title: null },
      subtopic: null,
      subtopicTags: [],
      labels: ["chapter_question"],
      contentHash: "stray",
    });

    const scope = buildScopeFromQuestions([stray]);

    expect(scope.chapters[0].title).toBe("Uncategorized");
  });

  it("keeps banks with more than twenty chapters", () => {
    const questions = Array.from({ length: 25 }, (_, index) =>
      materialQuestionFixture({
        chapter: { number: index + 1, title: `Chapter ${index + 1}` },
        subtopicTags: [`Chapter ${index + 1}`],
        contentHash: `hash-${index}`,
      })
    );

    const scope = buildScopeFromQuestions(questions);

    expect(scope.chapters).toHaveLength(25);
  });
});

describe("applyModelAudit", () => {
  const auditFor = (
    question: ReturnType<typeof materialQuestionFixture>,
    verdict: Partial<MaterialAuditRecord["verdict"]> = {}
  ): MaterialAuditRecord => ({
    fingerprint: materialAuditFingerprint(question),
    promptVersion: "v-test",
    command: "cli",
    auditedAt: "2026-09-29T00:00:00.000Z",
    verdict: {
      complete: true,
      optionsClean: true,
      modelAnswer: "B",
      keyVerdict: "correct",
      explanationMatches: true,
      issues: [],
      ...verdict,
    },
  });

  it("keeps a clean, correctly keyed question servable", () => {
    const question = materialQuestionFixture();
    const [result] = applyModelAudit([question], [auditFor(question)]).questions;
    expect(result.reviewStatus).toBe("ready");
    expect(result.repairFlags).toEqual([]);
  });

  it("routes incomplete or corrupted questions to needs_repair", () => {
    const question = materialQuestionFixture();
    const audit = auditFor(question, { complete: false, issues: ["Question starts mid-sentence"] });
    const [result] = applyModelAudit([question], [audit]).questions;
    expect(result.reviewStatus).toBe("needs_repair");
    expect(result.repairFlags).toContain("model_audit_structure");
    expect(result.repairActions.at(-1)?.note).toContain("Question starts mid-sentence");
  });

  it("routes a disputed answer key to needs_user_review with the model answer", () => {
    const question = materialQuestionFixture();
    const audit = auditFor(question, { keyVerdict: "wrong", modelAnswer: "C" });
    const [result] = applyModelAudit([question], [audit]).questions;
    expect(result.reviewStatus).toBe("needs_user_review");
    expect(result.repairFlags).toContain("model_audit_key_disputed");
    expect(result.repairActions.at(-1)?.note).toContain("C");
  });

  it("routes an unsure key to needs_user_review", () => {
    const question = materialQuestionFixture();
    const [result] = applyModelAudit([question], [auditFor(question, { keyVerdict: "unsure" })]).questions;
    expect(result.reviewStatus).toBe("needs_user_review");
    expect(result.repairFlags).toContain("model_audit_key_disputed");
  });

  it("drops an explanation that belongs to another question but keeps the question servable", () => {
    const question = materialQuestionFixture();
    const [result] = applyModelAudit([question], [auditFor(question, { explanationMatches: false })]).questions;
    expect(result.reviewStatus).toBe("ready");
    expect(result.answerExplanation).toBeNull();
  });

  it("ignores stale audits whose fingerprint no longer matches", () => {
    const question = materialQuestionFixture();
    const audit = auditFor(question, { keyVerdict: "wrong" });
    const changed = materialQuestionFixture({ answerLabels: ["C"], correctAnswers: [2] });
    const outcome = applyModelAudit([changed], [audit]);
    expect(outcome.questions[0].reviewStatus).toBe("ready");
    expect(outcome.stats.unaudited).toBe(1);
  });

  it("does not touch questions that are already excluded from quizzes", () => {
    const question = materialQuestionFixture({ reviewStatus: "needs_repair" });
    const [result] = applyModelAudit([question], [auditFor(question, { keyVerdict: "wrong" })]).questions;
    expect(result.reviewStatus).toBe("needs_repair");
    expect(result.repairFlags).toEqual([]);
  });
});
