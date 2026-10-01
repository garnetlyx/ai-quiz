import { createHash } from "crypto";
import type { TopicScope } from "@ai-quiz/shared";
import type { MaterialQuestion, MaterialReviewItem } from "./materialExtraction.js";
import { normalizeBankText } from "./materialTextNormalize.js";
import { normalizeScope } from "./scope.js";

export interface MergedQuestionBank {
  questions: MaterialQuestion[];
  duplicateCount: number;
  normalizedCount: number;
  conflictCount: number;
}

const alnum = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

function nearDuplicateKey(question: MaterialQuestion): string {
  const options = question.options.map((option) => alnum(option.text).slice(0, 12)).sort();
  return `${alnum(question.question).slice(0, 100)}|${options.join(",")}`;
}

function keyedAnswerText(question: MaterialQuestion): string {
  const index = question.correctAnswers[0];
  return index === undefined ? "" : alnum(question.options[index]?.text ?? "");
}

// One answer is the same as another, or a truncated copy of it.
function answersCompatible(a: string, b: string): boolean {
  if (!a || !b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 8 ? long.startsWith(short) : short === long;
}

function servableRank(question: MaterialQuestion): number {
  return isServableMaterialQuestion(question) ? 0 : 1;
}

function optionLength(question: MaterialQuestion): number {
  return question.options.reduce((total, option) => total + option.text.length, 0);
}

function betterCopy(a: MaterialQuestion, b: MaterialQuestion): MaterialQuestion {
  const keyA = [servableRank(a), a.repairFlags.length, a.answerExplanation ? 0 : 1, -optionLength(a)];
  const keyB = [servableRank(b), b.repairFlags.length, b.answerExplanation ? 0 : 1, -optionLength(b)];
  for (let i = 0; i < keyA.length; i++) {
    if (keyA[i] !== keyB[i]) return keyA[i] < keyB[i] ? a : b;
  }
  return a;
}

// Collapses repeated copies of the same question (the same book scanned more
// than once). Copies whose keyed answers disagree are never resolved by guess:
// the surviving record goes to user review.
export function dedupeNearDuplicates(questions: MaterialQuestion[]) {
  const groups = new Map<string, MaterialQuestion[]>();
  for (const question of questions) {
    const key = nearDuplicateKey(question);
    const group = groups.get(key);
    if (group) group.push(question);
    else groups.set(key, [question]);
  }

  let removedCount = 0;
  let conflictCount = 0;
  const kept = new Map<string, MaterialQuestion>();
  for (const [key, group] of groups) {
    removedCount += group.length - 1;
    let best = group.reduce(betterCopy);
    const answers = group.map(keyedAnswerText);
    const conflicting = answers.some((answer) => !answersCompatible(answer, answers[0]) || !answersCompatible(answer, keyedAnswerText(best)));
    if (conflicting && isServableMaterialQuestion(best)) {
      conflictCount += 1;
      best = {
        ...best,
        reviewStatus: "needs_user_review",
        repairFlags: [...best.repairFlags, "model_audit_key_disputed"],
        repairActions: [...best.repairActions, {
          type: "duplicate_answer_conflict",
          status: "failed",
          note: `${group.length} scanned copies of this question disagree on the correct answer; confirm against the source answer key.`,
        }],
      };
    }
    kept.set(key, best);
  }
  // Preserve first-seen order of the surviving groups.
  const ordered = [...new Set(questions.map(nearDuplicateKey))].map((key) => kept.get(key)!);
  return { questions: ordered, removedCount, conflictCount };
}

// Merges independently extracted banks into one, keeping the first occurrence
// of each content hash so caller order defines precedence, then repairs
// deterministic OCR text damage and collapses repeated scans of a question.
export function mergeQuestionBanks(banks: MaterialQuestion[][]): MergedQuestionBank {
  const seen = new Set<string>();
  const unique: MaterialQuestion[] = [];
  let duplicateCount = 0;
  for (const bank of banks) {
    for (const question of bank) {
      if (seen.has(question.contentHash)) {
        duplicateCount += 1;
        continue;
      }
      seen.add(question.contentHash);
      unique.push(question);
    }
  }
  const normalized = normalizeBankText(unique);
  const deduped = dedupeNearDuplicates(normalized.questions);
  return {
    questions: deduped.questions,
    duplicateCount: duplicateCount + deduped.removedCount,
    normalizedCount: normalized.changedCount,
    conflictCount: deduped.conflictCount,
  };
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
