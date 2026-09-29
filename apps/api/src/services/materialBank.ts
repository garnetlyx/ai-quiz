import { createHash } from "crypto";
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

export interface MaterialAuditVerdict {
  complete: boolean;
  optionsClean: boolean;
  modelAnswer: "A" | "B" | "C" | "D" | null;
  keyVerdict: "correct" | "wrong" | "unsure";
  explanationMatches: boolean | null;
  issues: string[];
}

export interface MaterialAuditRecord {
  fingerprint: string;
  promptVersion: string;
  command: string;
  auditedAt: string;
  verdict: MaterialAuditVerdict;
}

// Only servable records are audited and gated; excluded ones are already off the quiz path.
export function isServableMaterialQuestion(question: MaterialQuestion): boolean {
  return question.reviewStatus === "ready" || question.reviewStatus === "auto_repaired";
}

// Identifies exactly what the model judged, so a verdict goes stale when the
// question, options, key, or explanation change.
export function materialAuditFingerprint(question: MaterialQuestion): string {
  return createHash("sha256")
    .update(JSON.stringify([
      question.question,
      question.options.map((option) => [option.id, option.text]),
      question.answerLabels,
      question.answerExplanation ?? null,
    ]))
    .digest("hex");
}

export function applyModelAudit(questions: MaterialQuestion[], audits: MaterialAuditRecord[]) {
  const byFingerprint = new Map(audits.map((audit) => [audit.fingerprint, audit]));
  const stats = { audited: 0, unaudited: 0, structure: 0, keyDisputed: 0, explanationDropped: 0 };

  const result = questions.map((question) => {
    if (!isServableMaterialQuestion(question)) return question;
    const audit = byFingerprint.get(materialAuditFingerprint(question));
    if (!audit) {
      stats.unaudited += 1;
      return question;
    }
    stats.audited += 1;
    const { verdict } = audit;
    const issues = verdict.issues.join("; ");
    const next: MaterialQuestion = {
      ...question,
      repairFlags: [...question.repairFlags],
      repairActions: [...question.repairActions],
    };

    if (!verdict.complete || !verdict.optionsClean) {
      stats.structure += 1;
      next.reviewStatus = "needs_repair";
      next.repairFlags.push("model_audit_structure");
      next.repairActions.push({ type: "model_audit", status: "failed", note: `Model audit (${audit.promptVersion}): ${issues}` });
      return next;
    }
    if (verdict.keyVerdict !== "correct") {
      stats.keyDisputed += 1;
      next.reviewStatus = "needs_user_review";
      next.repairFlags.push("model_audit_key_disputed");
      next.repairActions.push({
        type: "model_audit",
        status: "failed",
        note: `Model audit (${audit.promptVersion}): key ${verdict.keyVerdict}, model answer ${verdict.modelAnswer ?? "none"}. ${issues}`,
      });
      return next;
    }
    if (verdict.explanationMatches === false && next.answerExplanation) {
      stats.explanationDropped += 1;
      next.answerExplanation = null;
      next.repairActions.push({ type: "model_audit", status: "applied", note: `Dropped explanation that does not belong to this question. ${issues}` });
    }
    return next;
  });

  return { questions: result, stats };
}
