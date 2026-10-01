import "../src/env.js";
import { describe, expect, it } from "vitest";
import {
  applyModelAudit,
  buildScopeFromQuestions,
  dedupeNearDuplicates,
  materialAuditFingerprint,
  mergeQuestionBanks,
  type MaterialAuditRecord,
} from "../src/services/materialBank.js";
import { materialQuestionFixture } from "./helpers/materialQuestion.js";

describe("mergeQuestionBanks", () => {
  it("keeps the first occurrence of each content hash across banks", () => {
    const first = materialQuestionFixture({ contentHash: "dup" });
    const second = materialQuestionFixture({ contentHash: "dup", question: "Duplicate wording" });
    const unique = materialQuestionFixture({ contentHash: "unique", question: "Which right applies to oceanfront property?" });

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

describe("dedupeNearDuplicates", () => {
  const opts = (texts: string[]) => texts.map((text, i) => ({ id: "ABCD"[i] as "A", text }));
  const base = {
    question: "A limited partnership is a preferable method of owning investment property because:",
    options: opts(["it limits liability", "it avoids taxes", "it is cheaper", "it is faster"]),
    answerLabels: ["A" as const],
    correctAnswers: [0],
  };

  it("keeps one copy of a repeated question and prefers the one with fewer flags", () => {
    const flagged = materialQuestionFixture({ ...base, contentHash: "a", repairFlags: ["option_swallowed_text"], reviewStatus: "ready" });
    const clean = materialQuestionFixture({ ...base, contentHash: "b", sourceLocation: { filePath: "second.pdf", lineStart: 1, lineEnd: 1, sectionTitle: null } });

    const result = dedupeNearDuplicates([flagged, clean]);

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].contentHash).toBe("b");
    expect(result.removedCount).toBe(1);
  });

  it("treats a truncated copy of the same answer as compatible", () => {
    const full = materialQuestionFixture({
      ...base, contentHash: "full",
      options: opts(["register with the Department of Licensing at least 20 days before work", "x1", "x2", "x3"]),
    });
    const truncated = materialQuestionFixture({
      ...base, contentHash: "cut", repairFlags: ["option_swallowed_text"],
      options: opts(["register with the Department of Licensing at least", "x1", "x2", "x3"]),
    });

    const result = dedupeNearDuplicates([truncated, full]);

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].contentHash).toBe("full");
    expect(result.questions[0].reviewStatus).toBe("ready");
    expect(result.conflictCount).toBe(0);
  });

  it("sends copies that disagree on the answer to user review instead of picking one", () => {
    const first = materialQuestionFixture({ ...base, contentHash: "a" });
    const second = materialQuestionFixture({ ...base, contentHash: "b", answerLabels: ["B"], correctAnswers: [1] });

    const result = dedupeNearDuplicates([first, second]);

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].reviewStatus).toBe("needs_user_review");
    expect(result.questions[0].repairFlags).toContain("model_audit_key_disputed");
    expect(result.conflictCount).toBe(1);
  });

  it("does not merge questions that share a prompt but have different options", () => {
    const one = materialQuestionFixture({ ...base, question: "Which is true?", contentHash: "a" });
    const two = materialQuestionFixture({ ...base, question: "Which is true?", contentHash: "b", options: opts(["p", "q", "r", "s"]) });

    expect(dedupeNearDuplicates([one, two]).questions).toHaveLength(2);
  });
});

describe("mergeQuestionBanks normalization", () => {
  it("normalizes OCR text and drops near-duplicates across banks", () => {
    const text = { question: "Alisting agent owes duties to the seller", options: [
      { id: "A" as const, text: "loyalty" }, { id: "B" as const, text: "cost" }, { id: "C" as const, text: "none" }, { id: "D" as const, text: "tax" },
    ] };
    const pdf = materialQuestionFixture({ ...text, contentHash: "pdf", sourceLocation: { filePath: "book.pdf", lineStart: 1, lineEnd: 1, sectionTitle: null } });
    const plain = materialQuestionFixture({ ...text, question: "A listing agent owes duties to the seller", contentHash: "txt" });
    const filler = Array.from({ length: 6 }, (_, i) => materialQuestionFixture({ contentHash: `f${i}`, question: `The listing agent and the seller number ${i}` }));

    const merged = mergeQuestionBanks([[pdf], [plain, ...filler]]);

    expect(merged.questions.filter((q) => q.question.startsWith("A listing agent owes"))).toHaveLength(1);
    expect(merged.duplicateCount).toBeGreaterThanOrEqual(1);
  });
});
