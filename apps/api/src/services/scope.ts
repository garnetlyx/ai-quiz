import { randomUUID } from "crypto";
import type {
  TopicMaterials,
  TopicScope,
  TopicScopeChapter,
  TopicScopeItem,
} from "@ai-quiz/shared";

export const DEFAULT_MATERIALS: TopicMaterials = {
  examples: "",
  additionalTopics: "",
  notes: "",
  instructions: "",
};

export function defaultScope(description: string): TopicScope {
  return {
    chapters: [
      {
        id: randomUUID(),
        title: "General scope",
        items: [
          {
            id: randomUUID(),
            title: description.trim() || "Core topics",
            details: "",
            frozen: false,
          },
        ],
      },
    ],
  };
}

function cleanText(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function normalizeMaterials(value: unknown): TopicMaterials {
  const input = value && typeof value === "object" ? value as Partial<TopicMaterials> : {};
  return {
    examples: cleanText(input.examples, 4000),
    additionalTopics: cleanText(input.additionalTopics, 2000),
    notes: cleanText(input.notes, 4000),
    instructions: cleanText(input.instructions, 4000),
  };
}

export function normalizeScope(value: unknown): TopicScope {
  const input = value && typeof value === "object" ? value as Partial<TopicScope> : {};
  const chapters = Array.isArray(input.chapters) ? input.chapters : [];

  return {
    chapters: chapters
      .slice(0, 50)
      .map((chapter): TopicScopeChapter => {
        const rawItems = Array.isArray(chapter?.items) ? chapter.items : [];
        return {
          id: cleanText(chapter?.id, 80) || randomUUID(),
          title: cleanText(chapter?.title, 200) || "Untitled chapter",
          items: rawItems
            .slice(0, 100)
            .map((item): TopicScopeItem => ({
              id: cleanText(item?.id, 80) || randomUUID(),
              title: cleanText(item?.title, 200),
              details: cleanText(item?.details, 1000),
              frozen: Boolean(item?.frozen),
            }))
            .filter((item) => item.title.length > 0),
        };
      })
      .filter((chapter) => chapter.items.length > 0),
  };
}

export function activeScopeItems(scope: TopicScope): TopicScopeItem[] {
  return scope.chapters.flatMap((chapter) =>
    chapter.items.filter((item) => !item.frozen)
  );
}

export function scopeItemExists(scope: TopicScope, itemId: string): boolean {
  return scope.chapters.some((chapter) =>
    chapter.items.some((item) => item.id === itemId)
  );
}

export function mergeScopeWithUsage(
  current: TopicScope,
  incoming: TopicScope,
  usedItemIds: Set<string>
): TopicScope {
  const normalizedCurrent = normalizeScope(current);
  const normalizedIncoming = normalizeScope(incoming);
  const incomingIds = new Set(
    normalizedIncoming.chapters.flatMap((chapter) =>
      chapter.items.map((item) => item.id)
    )
  );
  const frozenItems = normalizedCurrent.chapters.flatMap((chapter) =>
    chapter.items
      .filter((item) => usedItemIds.has(item.id) && !incomingIds.has(item.id))
      .map((item) => ({ ...item, frozen: true }))
  );

  if (frozenItems.length === 0) return normalizedIncoming;

  return {
    chapters: [
      ...normalizedIncoming.chapters,
      {
        id: "frozen-removed",
        title: "Frozen removed topics",
        items: frozenItems,
      },
    ],
  };
}

export function assertScopeIsUsable(scope: TopicScope) {
  if (activeScopeItems(scope).length === 0) {
    throw new Error("At least one active chapter topic is required");
  }
}

export function buildScopeContext(
  scope: TopicScope,
  materials: TopicMaterials
): string {
  const lines = scope.chapters.map((chapter) => {
    const items = chapter.items
      .filter((item) => !item.frozen)
      .map((item) =>
        item.details ? `  - ${item.id}: ${item.title} — ${item.details}` : `  - ${item.id}: ${item.title}`
      )
      .join("\n");
    return `${chapter.title}\n${items}`;
  });

  const materialLines = [
    materials.examples ? `Examples:\n${materials.examples}` : "",
    materials.additionalTopics ? `Additional topics:\n${materials.additionalTopics}` : "",
    materials.notes ? `Notes:\n${materials.notes}` : "",
  ].filter(Boolean);

  return [...lines, ...materialLines].join("\n\n");
}

export function mergeSuggestedScope(
  current: TopicScope,
  suggestion: TopicScope
): TopicScope {
  const normalizedCurrent = normalizeScope(current);
  const normalizedSuggestion = normalizeScope(suggestion);
  const chapters = normalizedCurrent.chapters.map((chapter) => ({
    ...chapter,
    items: chapter.items.map((item) => ({ ...item })),
  }));

  for (const suggestedChapter of normalizedSuggestion.chapters) {
    const chapterIndex = chapters.findIndex(
      (chapter) => chapter.title.trim().toLowerCase() === suggestedChapter.title.trim().toLowerCase()
    );

    if (chapterIndex === -1) {
      chapters.push({
        ...suggestedChapter,
        items: suggestedChapter.items.map((item) => ({ ...item, frozen: false })),
      });
      continue;
    }

    const existingChapter = chapters[chapterIndex];
    const existingTitles = new Map(
      existingChapter.items.map((item, index) => [item.title.trim().toLowerCase(), index])
    );

    for (const suggestedItem of suggestedChapter.items) {
      const existingIndex = existingTitles.get(suggestedItem.title.trim().toLowerCase());
      if (existingIndex === undefined) {
        existingChapter.items.push({ ...suggestedItem, frozen: false });
        continue;
      }

      const currentItem = existingChapter.items[existingIndex];
      if (!currentItem.details && suggestedItem.details) {
        existingChapter.items[existingIndex] = {
          ...currentItem,
          details: suggestedItem.details,
        };
      }
    }
  }

  return { chapters };
}
