import "../src/env.js";
import { describe, expect, it } from "vitest";
import { buildScopeFromQuestions, mergeQuestionBanks } from "../src/services/materialBank.js";
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
