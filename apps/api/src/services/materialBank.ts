import type { TopicScope } from "@ai-quiz/shared";
import type { MaterialQuestion, MaterialReviewItem } from "./materialExtraction.js";
import { normalizeScope } from "./scope.js";

export interface MergedQuestionBank {
  questions: MaterialQuestion[];
  duplicateCount: number;
}

// Merges independently extracted banks into one, keeping the first occurrence
// of each content hash so caller order defines precedence.
export function mergeQuestionBanks(banks: MaterialQuestion[][]): MergedQuestionBank {
  const seen = new Set<string>();
  const questions: MaterialQuestion[] = [];
  let duplicateCount = 0;
  for (const bank of banks) {
    for (const question of bank) {
      if (seen.has(question.contentHash)) {
        duplicateCount += 1;
        continue;
      }
      seen.add(question.contentHash);
      questions.push(question);
    }
  }
  return { questions, duplicateCount };
}

export function buildReviewItems(questions: MaterialQuestion[]): MaterialReviewItem[] {
  return questions
    .filter((question) => question.reviewStatus === "needs_user_review")
    .map((question) => ({
      id: `review-${question.id}`,
      reason: question.answerLabels.length === 0
        ? "Missing answer"
        : question.options.length !== 4
          ? "Expected four answer options"
          : "Low confidence OCR extraction",
      question,
    }));
}

// Derives a study scope from the bank's own metadata: textbook chapters become
// chapters, exam labels and practice-test tags become their own study units.
export function buildScopeFromQuestions(questions: MaterialQuestion[]): TopicScope {
  const chapters = new Map<string, { title: string; order: number; items: Set<string> }>();

  const ensureChapter = (title: string, order: number) => {
    let chapter = chapters.get(title);
    if (!chapter) {
      chapter = { title, order, items: new Set() };
      chapters.set(title, chapter);
    }
    chapter.order = Math.min(chapter.order, order);
    return chapter;
  };

  for (const question of questions) {
    const chapterTitle =
      question.chapter?.title ||
      question.labels.find((label) => label && label !== question.source) ||
      "Uncategorized";
    const itemTitle = question.subtopicTags[0] || question.subtopic || chapterTitle;
    ensureChapter(chapterTitle, question.chapter?.number ?? Number.MAX_SAFE_INTEGER).items.add(itemTitle);
  }

  return normalizeScope({
    chapters: [...chapters.values()]
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
      .map((chapter) => ({
        title: chapter.title,
        items: [...chapter.items].map((title) => ({ title })),
      })),
  });
}
