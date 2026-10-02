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
  garbledCount: number;
}

const alnum = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const MIN_PROMPT_SIMILARITY = 0.6;

const OPTION_PREFIX_LENGTH = 12;

// The opening characters of each answer choice, so OCR damage further in does not matter.
function optionPrefixes(question: MaterialQuestion): Map<string, number> {
  const counts = new Map<string, number>();
  for (const option of question.options) {
    const prefix = alnum(option.text).slice(0, OPTION_PREFIX_LENGTH);
    if (prefix) counts.set(prefix, (counts.get(prefix) || 0) + 1);
  }
  return counts;
}

function sharedOptionCount(a: Map<string, number>, b: Map<string, number>): number {
  let shared = 0;
  for (const [prefix, count] of a) shared += Math.min(count, b.get(prefix) || 0);
  return shared;
}

function promptWords(question: MaterialQuestion): Set<string> {
  return new Set(question.question.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

// How much of the smaller prompt appears in the larger one; a damaged copy
// that absorbed a neighbouring question still contains the real prompt.
function containment(a: Set<string>, b: Set<string>): number {
  const smaller = a.size <= b.size ? a : b;
  const larger = smaller === a ? b : a;
  // A very short prompt is contained in many unrelated ones; it is no evidence.
  if (smaller.size < MIN_CONTAINED_WORDS) return 0;
  let shared = 0;
  for (const word of smaller) if (larger.has(word)) shared += 1;
  return shared / smaller.size;
}

const MIN_PROMPT_CONTAINMENT = 0.7;
const MIN_CONTAINED_WORDS = 5;

// Two records are the same question when their answer choices and prompts line up
// well enough; unrelated prompts that merely share choices stay separate.
function sameQuestion(
  a: { words: Set<string>; options: Map<string, number> },
  b: { words: Set<string>; options: Map<string, number> }
): boolean {
  const shared = sharedOptionCount(a.options, b.options);
  const similarity = jaccard(a.words, b.words);
  if (shared >= 4 && similarity >= MIN_PROMPT_SIMILARITY) return true;
  if (shared >= 3 && containment(a.words, b.words) >= MIN_PROMPT_CONTAINMENT) return true;
  return shared >= 2 && similarity >= 0.8;
}

function rawKeyedText(question: MaterialQuestion): string {
  const index = question.correctAnswers[0];
  return index === undefined ? "" : question.options[index]?.text ?? "";
}

function keyedAnswerText(question: MaterialQuestion): string {
  const index = question.correctAnswers[0];
  return index === undefined ? "" : alnum(question.options[index]?.text ?? "");
}

const MIN_ANSWER_WORD_OVERLAP = 0.6;

// One answer is the same as another, a truncated copy of it, or the same words
// read slightly differently by OCR. Only answers that genuinely differ conflict.
function answersCompatible(a: string, b: string, textA: string, textB: string): boolean {
  if (!a || !b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 8 ? long.startsWith(short) : short === long) return true;
  const wordsOfText = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]{2,}/g) || []);
  return jaccard(wordsOfText(textA), wordsOfText(textB)) >= MIN_ANSWER_WORD_OVERLAP;
}

function servableRank(question: MaterialQuestion): number {
  return isServableMaterialQuestion(question) ? 0 : 1;
}

function optionLength(question: MaterialQuestion): number {
  return question.options.reduce((total, option) => total + option.text.length, 0);
}

// Among copies of one question: servable first, then the one with fewer
// unreadable words (a relative measure, so gaps in the word list cancel out),
// then fewer flags, an explanation, and the more complete options.
function betterCopy(
  a: MaterialQuestion,
  b: MaterialQuestion,
  damageOf: (question: MaterialQuestion) => number,
  auditFailed: (question: MaterialQuestion) => boolean
): MaterialQuestion {
  const rank = (question: MaterialQuestion) => [
    servableRank(question) === 0 && !auditFailed(question) ? 0 : 1,
    damageOf(question),
    question.repairFlags.length,
    question.answerExplanation ? 0 : 1,
    -optionLength(question),
  ];
  const keyA = rank(a);
  const keyB = rank(b);
  for (let i = 0; i < keyA.length; i++) {
    if (keyA[i] !== keyB[i]) return keyA[i] < keyB[i] ? a : b;
  }
  return a;
}

// Collapses repeated copies of the same question (the same book scanned more
// than once). Copies whose keyed answers disagree are never resolved by guess:
// the surviving record goes to user review.
export function dedupeNearDuplicates(
  questions: MaterialQuestion[],
  damageOf: (question: MaterialQuestion) => number = () => 0,
  auditFailed: (question: MaterialQuestion) => boolean = () => false
) {
  // Group records that are the same question (union-find over pairwise checks).
  const features = questions.map((question) => ({ words: promptWords(question), options: optionPrefixes(question) }));
  const parent = questions.map((_, index) => index);
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  for (let i = 0; i < questions.length; i++) {
    for (let j = i + 1; j < questions.length; j++) {
      if (find(i) !== find(j) && sameQuestion(features[i], features[j])) parent[find(j)] = find(i);
    }
  }
  const byRoot = new Map<number, { members: MaterialQuestion[]; first: number }>();
  questions.forEach((question, index) => {
    const root = find(index);
    const cluster = byRoot.get(root);
    if (cluster) cluster.members.push(question);
    else byRoot.set(root, { members: [question], first: index });
  });
  const clusters = [...byRoot.values()].sort((a, b) => a.first - b.first);

  let removedCount = 0;
  let conflictCount = 0;
  const ordered = clusters.map(({ members: group }) => {
    removedCount += group.length - 1;
    let best = group.reduce((a, b) => betterCopy(a, b, damageOf, auditFailed));
    const answers = group.map((member) => ({ key: keyedAnswerText(member), text: rawKeyedText(member) }));
    const reference = { key: keyedAnswerText(best), text: rawKeyedText(best) };
    const conflicting = answers.some((answer) => !answersCompatible(answer.key, reference.key, answer.text, reference.text));
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
    return best;
  });
  return { questions: ordered, removedCount, conflictCount };
}

const GARBLE_WORD = /(?<![A-Za-z'’])[A-Za-z]{3,}(?![A-Za-z'’])/g;
const GARBLE_MIN_UNKNOWN_WORDS = 2;
const MIN_INFLECTION_STEM = 3;
const INFLECTION_SUFFIXES = ["s", "es", "ed", "d", "ing", "ly", "er", "ers", "al", "ation", "ment"];

// A word counts as known if the list has it or a simple inflection of it.
export function buildKnownWordPredicate(words: Set<string>): (word: string) => boolean {
  return (word) => {
    if (words.has(word)) return true;
    for (const suffix of INFLECTION_SUFFIXES) {
      if (!word.endsWith(suffix)) continue;
      const stem = word.slice(0, -suffix.length);
      // Tiny stems ("fu" + "ing") match garbage far more often than real words.
      if (stem.length >= MIN_INFLECTION_STEM && (words.has(stem) || words.has(`${stem}e`))) return true;
    }
    return word.endsWith("ies") && words.has(`${word.slice(0, -3)}y`);
  };
}

function wordsOf(question: MaterialQuestion): string[] {
  return [question.question, ...question.options.map((option) => option.text)]
    .flatMap((text) => text.normalize("NFKC").match(GARBLE_WORD) || []);
}

// OCR garbage is made of words that are neither real words nor repeated
// anywhere else in the bank. Rare real vocabulary is in the word list, names
// are capitalized, and recurring terms appear in more than one record.
export function flagGarbledQuestions(
  questions: MaterialQuestion[],
  isKnownWord: (word: string) => boolean,
  // One copy per question, so damage repeated across duplicate scans still
  // counts as a one-off. Defaults to the questions themselves.
  reference: MaterialQuestion[] = questions
) {
  const recordCount = new Map<string, number>();
  for (const question of reference) {
    const seen = new Set([
      ...wordsOf(question),
      ...((question.answerExplanation || "").normalize("NFKC").match(GARBLE_WORD) || []),
    ].map((word) => word.toLowerCase()));
    for (const word of seen) recordCount.set(word, (recordCount.get(word) || 0) + 1);
  }

  let flaggedCount = 0;
  const result = questions.map((question) => {
    if (!isServableMaterialQuestion(question)) return question;
    const unknown = wordsOf(question).filter((word) =>
      word[0] === word[0].toLowerCase() &&
      (recordCount.get(word.toLowerCase()) || 0) <= 1 &&
      !isKnownWord(word.toLowerCase()));
    if (unknown.length < GARBLE_MIN_UNKNOWN_WORDS) return question;
    flaggedCount += 1;
    return {
      ...question,
      reviewStatus: "needs_repair" as const,
      repairFlags: [...question.repairFlags, "explicit_ocr_layout_pollution" as const],
      repairActions: [...question.repairActions, {
        type: "garbled_text_check",
        status: "failed" as const,
        note: `Text contains words that are neither real words nor repeated elsewhere: ${[...new Set(unknown)].slice(0, 8).join(", ")}.`,
      }],
    };
  });
  return { questions: result, flaggedCount };
}

// Merges independently extracted banks into one, keeping the first occurrence
// of each content hash so caller order defines precedence, then repairs
// deterministic OCR text damage and collapses repeated scans of a question.
export function mergeQuestionBanks(
  banks: MaterialQuestion[][],
  options: { isKnownWord?: (word: string) => boolean; audits?: MaterialAuditRecord[] } = {}
): MergedQuestionBank {
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
  // Garbled copies are excluded before dedup so a clean duplicate copy wins.
  const garbled = options.isKnownWord
    ? flagGarbledQuestions(normalized.questions, options.isKnownWord, dedupeNearDuplicates(normalized.questions).questions)
    : { questions: normalized.questions, flaggedCount: 0 };
  const isKnownWord = options.isKnownWord;
  const damageOf = isKnownWord
    ? (question: MaterialQuestion) => wordsOf(question).filter((word) => !isKnownWord(word.toLowerCase())).length
    : undefined;
  // Audit verdicts decide which copy of a question survives; they are applied for real
  // later, on the final text.
  const verdictByFingerprint = new Map((options.audits || []).map((audit) => [audit.fingerprint, audit.verdict]));
  const auditFailed = (question: MaterialQuestion) => {
    const verdict = verdictByFingerprint.get(materialAuditFingerprint(question));
    return verdict ? auditVerdictFails(verdict) : false;
  };
  const deduped = dedupeNearDuplicates(garbled.questions, damageOf, auditFailed);
  return {
    questions: deduped.questions,
    duplicateCount: duplicateCount + deduped.removedCount,
    normalizedCount: normalized.changedCount,
    conflictCount: deduped.conflictCount,
    garbledCount: garbled.flaggedCount,
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

// A verdict removes a question from quizzes when the question is broken or the key is doubted.
export function auditVerdictFails(verdict: MaterialAuditVerdict): boolean {
  return !verdict.complete || !verdict.optionsClean || verdict.keyVerdict !== "correct";
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
