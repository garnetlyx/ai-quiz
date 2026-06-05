import "../src/env.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildScopePlan,
  computeContentHash,
  getWeakSubtopics,
} from "../src/services/quiz.js";
import type { TopicScopeItem } from "@ai-quiz/shared";

vi.mock("../src/db/index.js", () => ({
  db: {
    select: vi.fn(),
  },
}));

const { db } = await import("../src/db/index.js");
const selectMock = vi.mocked(db.select);

const scopeItems: TopicScopeItem[] = [
  { id: "alpha", title: "Alpha", details: "", frozen: false },
  { id: "beta", title: "Beta", details: "", frozen: false },
  { id: "gamma", title: "Gamma", details: "", frozen: false },
];

const topicRow = {
  id: "topic-1",
  userId: "user-1",
  title: "Weak subtopics topic",
  description: "Topic for weak subtopic tests",
  scope: {
    chapters: [
      {
        id: "chapter-1",
        title: "Chapter 1",
        items: scopeItems,
      },
    ],
  },
  materials: { examples: "", additionalTopics: "", notes: "", instructions: "" },
  examFormat: { choicesCount: 4, isMultiSelect: false },
  status: "confirmed",
  createdAt: new Date(),
  archivedAt: null,
};

const missedQuestions = [
  { subtopicTags: ["Alpha"], topicId: "topic-1", scopeItemId: "alpha" },
  { subtopicTags: ["Alpha"], topicId: "topic-1", scopeItemId: "alpha" },
  { subtopicTags: ["Beta"], topicId: "topic-1", scopeItemId: "beta" },
];

const allQuestions = [
  { subtopicTags: ["Alpha"], scopeItemId: "alpha" },
  { subtopicTags: ["Alpha"], scopeItemId: "alpha" },
  { subtopicTags: ["Alpha"], scopeItemId: "alpha" },
  { subtopicTags: ["Beta"], scopeItemId: "beta" },
  { subtopicTags: ["Beta"], scopeItemId: "beta" },
];

function mockSelectWithLimit(result: unknown[]) {
  const limit = vi.fn().mockResolvedValue(result);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  return { from };
}

function mockSelectWhere(result: unknown[]) {
  const where = vi.fn().mockResolvedValue(result);
  const from = vi.fn(() => ({ where }));
  return { from };
}

function mockWeakSubtopicQueries() {
  selectMock
    .mockReturnValueOnce(mockSelectWithLimit([topicRow]) as never)
    .mockReturnValueOnce(mockSelectWhere(missedQuestions) as never)
    .mockReturnValueOnce(mockSelectWhere(allQuestions) as never);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("computeContentHash", () => {
  it("returns the same hash for the same content", () => {
    const text = "Which deed transfers title?";

    expect(computeContentHash(text)).toBe(computeContentHash(text));
  });

  it("returns different hashes for different content", () => {
    expect(computeContentHash("Which deed transfers title?")).not.toBe(
      computeContentHash("Which lease transfers possession?")
    );
  });

  it("normalizes case before hashing", () => {
    expect(computeContentHash("WHICH DEED TRANSFERS TITLE")).toBe(
      computeContentHash("which deed transfers title")
    );
  });

  it("normalizes surrounding whitespace before hashing", () => {
    expect(computeContentHash("  Which deed transfers title  ")).toBe(
      computeContentHash("Which deed transfers title")
    );
  });

  it("normalizes trailing punctuation before hashing", () => {
    expect(computeContentHash("Which deed transfers title?")).toBe(
      computeContentHash("Which deed transfers title")
    );
  });
});

describe("buildScopePlan", () => {
  it("distributes questions evenly across items", () => {
    expect(buildScopePlan(scopeItems, 10)).toEqual([
      { id: "alpha", title: "Alpha", count: 4 },
      { id: "beta", title: "Beta", count: 3 },
      { id: "gamma", title: "Gamma", count: 3 },
    ]);
  });

  it("honors a subtopic filter", () => {
    expect(buildScopePlan(scopeItems, 5, ["beta", "Gamma"])).toEqual([
      { id: "beta", title: "Beta", count: 3 },
      { id: "gamma", title: "Gamma", count: 2 },
    ]);
  });

  it("falls back to all items when the filter matches none", () => {
    expect(buildScopePlan(scopeItems, 4, ["missing"])).toEqual([
      { id: "alpha", title: "Alpha", count: 2 },
      { id: "beta", title: "Beta", count: 1 },
      { id: "gamma", title: "Gamma", count: 1 },
    ]);
  });

  it("returns an empty plan for zero questions", () => {
    expect(buildScopePlan(scopeItems, 0)).toEqual([]);
  });

  it("handles a single item", () => {
    expect(buildScopePlan([scopeItems[0]], 5)).toEqual([
      { id: "alpha", title: "Alpha", count: 5 },
    ]);
  });
});

describe("getWeakSubtopics", () => {
  it("ignores flagged missed questions", async () => {
    mockWeakSubtopicQueries();

    const weakSubtopics = await getWeakSubtopics("topic-1", "user-1");

    expect(weakSubtopics.map((item) => item.subtopic)).not.toContain("Flagged");
  });

  it("calculates miss rates and sorts them descending", async () => {
    mockWeakSubtopicQueries();

    const weakSubtopics = await getWeakSubtopics("topic-1", "user-1");

    expect(weakSubtopics.slice(0, 2)).toEqual([
      { subtopic: "Alpha", missCount: 2, totalQuestions: 3, missRate: 67 },
      { subtopic: "Beta", missCount: 1, totalQuestions: 2, missRate: 50 },
    ]);
  });

  it("excludes subtopics with no misses from the weak list", async () => {
    mockWeakSubtopicQueries();

    const weakSubtopics = await getWeakSubtopics("topic-1", "user-1");

    expect(weakSubtopics.every((item) => item.missCount > 0)).toBe(true);
  });
});
