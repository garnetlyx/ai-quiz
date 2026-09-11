import type { MaterialQuestion } from "../../src/services/materialExtraction.js";

export function materialQuestionFixture(overrides: Partial<MaterialQuestion> = {}): MaterialQuestion {
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
    chapter: { number: 1, title: "The Nature of Real Property" },
    exam: null,
    subtopic: "The Nature of Real Property",
    subtopicTags: ["The Nature of Real Property"],
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
