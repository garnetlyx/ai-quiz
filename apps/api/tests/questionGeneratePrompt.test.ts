import { describe, expect, it } from "vitest";
import { buildQuestionGenerateMessages } from "../src/prompts/question-generate.js";

describe("question generate prompt", () => {
  it("passes generation instructions separately from scope context", () => {
    const messages = buildQuestionGenerateMessages({
      topic: "Japanese N2",
      format: { choicesCount: 4, isMultiSelect: false },
      count: 3,
      existingHashes: [],
      instructions: "Provide explanations in Japanese and English.",
      scopeContext: "General scope\n  - item-1: Reading comprehension\n\nNotes:\nInference matters.",
      scopePlan: [{ id: "item-1", title: "Reading comprehension", count: 3 }],
    });

    const userMessage = messages.find((message) => message.role === "user");
    expect(userMessage?.content).toContain("Generation instructions:\nProvide explanations in Japanese and English.");
    expect(userMessage?.content).toContain("Study scope and supplemental material:\nGeneral scope");
  });
});
