import { describe, expect, it } from "vitest";
import {
  activeScopeItems,
  mergeScopeWithUsage,
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

    expect(plan).toEqual([
      { id: "a", title: "A", count: 2 },
      { id: "b", title: "B", count: 2 },
      { id: "c", title: "C", count: 1 },
    ]);
  });
});
