import { describe, expect, it } from "vitest";
import {
  activeScopeItems,
  buildScopeContext,
  mergeSuggestedScope,
  mergeScopeWithUsage,
  normalizeMaterials,
  normalizeScope,
} from "../src/services/scope.js";
import { buildScopePlan } from "../src/services/quiz.js";

describe("topic scope", () => {
  it("freezes removed used items and leaves new items active", () => {
    const current = normalizeScope({
      chapters: [
        {
          id: "chapter-1",
          title: "Chapter 1",
          items: [
            { id: "used", title: "Used topic", details: "", frozen: false },
            { id: "unused", title: "Unused topic", details: "", frozen: false },
          ],
        },
      ],
    });
    const incoming = normalizeScope({
      chapters: [
        {
          id: "chapter-2",
          title: "Chapter 2",
          items: [{ id: "new", title: "New topic", details: "", frozen: false }],
        },
      ],
    });

    const merged = mergeScopeWithUsage(current, incoming, new Set(["used"]));

    expect(activeScopeItems(merged).map((item) => item.id)).toEqual(["new"]);
    expect(
      merged.chapters.flatMap((chapter) => chapter.items).find((item) => item.id === "used")?.frozen
    ).toBe(true);
  });

  it("builds a balanced scope plan", () => {
    const plan = buildScopePlan(
      [
        { id: "a", title: "A", details: "", frozen: false },
        { id: "b", title: "B", details: "", frozen: false },
        { id: "c", title: "C", details: "", frozen: false },
      ],
      5
    );

    // Items are shuffled, so only the balance is deterministic.
    expect(plan.map((entry) => entry.id).sort()).toEqual(["a", "b", "c"]);
    expect(plan.map((entry) => entry.count).sort((x, y) => y - x)).toEqual([2, 2, 1]);
  });

  it("merges suggested scope without duplicating existing topics", () => {
    const current = normalizeScope({
      chapters: [
        {
          id: "chapter-1",
          title: "Chapter 1",
          items: [{ id: "item-1", title: "Ownership", details: "", frozen: false }],
        },
      ],
    });
    const suggested = normalizeScope({
      chapters: [
        {
          title: "Chapter 1",
          items: [
            { title: "Ownership", details: "" },
            { title: "Transfer", details: "" },
          ],
        },
        {
          title: "Chapter 2",
          items: [{ title: "Contracts", details: "" }],
        },
      ],
    });

    const merged = mergeSuggestedScope(current, suggested);

    expect(merged.chapters.find((chapter) => chapter.title === "Chapter 1")?.items.map((item) => item.title)).toEqual(
      ["Ownership", "Transfer"]
    );
    expect(merged.chapters.find((chapter) => chapter.title === "Chapter 2")?.items.map((item) => item.title)).toEqual(
      ["Contracts"]
    );
  });

  it("keeps generation instructions separate from scope material context", () => {
    const context = buildScopeContext(
      normalizeScope({
        chapters: [
          {
            title: "General",
            items: [{ title: "Item 1", details: "", frozen: false }],
          },
        ],
      }),
      normalizeMaterials({
        examples: "",
        additionalTopics: "Foreign language exam Japanese N2",
        notes: "Key point: inference matters.",
        instructions: "Provide explanations in Japanese and English.",
      })
    );

    expect(context).toContain("Additional topics:\nForeign language exam Japanese N2");
    expect(context).toContain("Notes:\nKey point: inference matters.");
    expect(context).not.toContain("Provide explanations in Japanese and English.");
  });
});
