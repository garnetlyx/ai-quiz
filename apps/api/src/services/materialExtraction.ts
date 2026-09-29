import { createHash } from "crypto";
import { buildReviewItems } from "./materialBank.js";

export type MaterialQuestionSource =
  | "example_question"
  | "chapter_question"
  | "exam_question";

export type ReviewStatus = "ready" | "auto_repaired" | "needs_repair" | "needs_user_review" | "unresolved";

export type RepairFlag =
  | "missing_or_extra_options"
  | "merged_numbered_question"
  | "prompt_contains_options"
  | "option_swallowed_text"
  | "too_short_prompt"
  | "explicit_ocr_layout_pollution"
  | "answer_label_not_in_options"
  | "no_answer_label"
  | "model_audit_structure"
  | "model_audit_key_disputed";

export interface RepairAction {
  type: string;
  status: "pending" | "applied" | "failed" | "not_attempted";
  note: string;
}

export interface MaterialQuestion {
  id: string;
  question: string;
  labels: string[];
  source: MaterialQuestionSource;
  options: { id: "A" | "B" | "C" | "D"; text: string }[];
  answerLabels: ("A" | "B" | "C" | "D")[];
  correctAnswers: number[];
  answerExplanation: string | null;
  chapter: {
    number: number | null;
    title: string | null;
  };
  exam: {
    number: number | null;
    questionNumber: number | null;
  } | null;
  subtopic: string | null;
  subtopicTags: string[];
  confidence: number;
  reviewStatus: ReviewStatus;
  repairFlags: RepairFlag[];
  repairActions: RepairAction[];
  rawCandidate: {
    question: string;
    options: { id: "A" | "B" | "C" | "D"; text: string }[];
    answerLabels: ("A" | "B" | "C" | "D")[];
  };
  sourceLocation: {
    filePath: string;
    lineStart: number;
    lineEnd: number;
    sectionTitle: string | null;
  };
  contentHash: string;
  duplicateOf: string | null;
}

export interface MaterialReviewItem {
  id: string;
  reason: string;
  question: MaterialQuestion;
}

export interface MaterialExtractionReport {
  generatedAt: string;
  inputFiles: string[];
  totalQuestions: number;
  readyQuestions: number;
  autoRepairedQuestions: number;
  needsRepairQuestions: number;
  needsUserReviewQuestions: number;
  unresolvedQuestions: number;
  manualReviewRate: number;
  repairDebtRate: number;
  duplicateQuestions: number;
  unmatchedAnswerQuestions: number;
  bySource: Record<MaterialQuestionSource, number>;
  ai: {
    enabled: boolean;
    model: string | null;
    classifiedSections: number;
    failedSections: number;
    verifiedQuestions: number;
    failedVerifications: number;
  };
}

export interface MaterialExtractionResult {
  questions: MaterialQuestion[];
  reviewItems: MaterialReviewItem[];
  report: MaterialExtractionReport;
}

export interface AiSectionClassifier {
  classify(input: {
    sectionTitle: string;
    source: MaterialQuestionSource;
    text: string;
  }): Promise<{ kind: "description" | "questions" | "mixed"; confidence: number }>;
}

export interface MaterialQuestionVerifier {
  verify(input: {
    question: string;
    options: { id: "A" | "B" | "C" | "D"; text: string }[];
    source: MaterialQuestionSource;
    chapterTitle: string | null;
    sectionTitle: string | null;
    nearbyText: string;
  }): Promise<{
    answerLabels: ("A" | "B" | "C" | "D")[];
    explanation: string;
    confidence: number;
  } | null>;
}

interface SourceLine {
  number: number;
  text: string;
}

interface Context {
  chapterNumber: number | null;
  chapterTitle: string | null;
  examNumber: number | null;
  sectionTitle: string | null;
}

interface RawQuestion {
  promptLines: string[];
  options: Partial<Record<"A" | "B" | "C" | "D", string[]>>;
  answerLabels: ("A" | "B" | "C" | "D")[];
  explanationLines: string[];
  source: MaterialQuestionSource;
  questionNumber: number | null;
  context: Context;
  lineStart: number;
  lineEnd: number;
}

interface AnswerEntry {
  labels: ("A" | "B" | "C" | "D")[];
  explanation: string;
}

interface RepairFunctionResult {
  modified: boolean;
  raw: RawQuestion;
  actions: RepairAction[];
}

interface RepairExecutionResult {
  raws: RawQuestion[];
  actionsByRaw: RepairAction[][];
}

const OPTION_IDS = ["A", "B", "C", "D"] as const;
const ANSWER_ENTRY_PATTERN = /(?:^|\s)(\d{1,3})[.)-]?\s*([A-D])\.?\s*(.*?)(?=\s+\d{1,3}[.)-]?\s*[A-D]\.?\s|$)/g;

/** Match an "Answer Key" heading, tolerating markdown emphasis (**Answer Key**) added by LLM OCR. */
function isAnswerKeyHeading(text: string): boolean {
  return /^\*{0,2}Answer Key\*{0,2}\s*$/i.test(text.trim());
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeLine(line: string): string {
  return line
    .replace(/\f/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanQuestionText(lines: string[]): string {
  return lines
    .map((line) => cleanExtractedText(line).replace(/^\d{1,3}[.)]\s*/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanExtractedText(value: string): string {
  return value
    .replace(/\[PDF_(PAGE|SOURCE)[^\]]*\]/g, " ")
    .replace(/(?<!\w)fi\s+fi(?!\w)/gi, " ")
    .replace(/(?<!\w)fl\s+fl(?!\w)/gi, " ")
    .replace(/\bfi(?:\s+fi|\s+fl|\s+fI|\s+Fi){2,}\b/gi, " ")
    .replace(/\bfl(?:\s+fi|\s+fl){2,}\b/gi, " ")
    .replace(/\s*[|_]{1,}\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNoiseLine(line: string): boolean {
  if (!line) return true;
  if (/^\d+$/.test(line)) return true;
  if (/^\[PDF_(PAGE|SOURCE)\b/.test(line)) return true;
  if (/^fi(?:\s+fi)+$/i.test(line)) return true;
  if (/^Insider's Guide to Passing the Washington Real Estate Exam$/i.test(line)) return true;
  if (/^Chapter \d+:/i.test(line)) return false;
  if (/^Sample Exam \d+/i.test(line)) return false;
  if (/^Chapter Quiz$/i.test(line)) return false;
  if (isAnswerKeyHeading(line)) return false;
  if (/^Sample Questions/i.test(line)) return false;
  return false;
}

function parseChapter(line: string): { number: number; title: string } | null {
  const match = line.match(/^Chapter\s+(\d+):\s*(.+)$/i);
  if (!match) return null;
  return { number: Number(match[1]), title: match[2].trim() };
}

function parseSampleExam(line: string): number | null {
  const match = line.match(/^Sample Exam\s+([0-9I]+)\b/i);
  if (!match) return null;
  if (match[1].toUpperCase() === "I") return 1;
  return Number(match[1]);
}

function optionMatch(line: string): { id: "A" | "B" | "C" | "D"; text: string } | null {
  const match = line.match(/^([A-D])[\.)]\s*(.+)?$/);
  if (!match) return null;
  return { id: match[1] as "A" | "B" | "C" | "D", text: (match[2] || "").trim() };
}

function numberedQuestionMatch(line: string): { number: number; text: string } | null {
  const match = line.match(/^(\d{1,3})[.)]\s+(.+)$/);
  if (!match) return null;
  return { number: Number(match[1]), text: match[2].trim() };
}

function answerMatch(line: string): { labels: ("A" | "B" | "C" | "D")[]; text: string } | null {
  const match = line.match(/^([A-D])[\.)]?\s+(.+)$/);
  if (!match) return null;
  return {
    labels: [match[1] as "A" | "B" | "C" | "D"],
    text: match[2].trim(),
  };
}

function answerKeyEntryMatch(line: string): { number: number; label: "A" | "B" | "C" | "D"; text: string } | null {
  return answerKeyEntriesFromLine(line)[0] || null;
}

function answerKeyEntriesFromLine(line: string): { number: number; label: "A" | "B" | "C" | "D"; text: string }[] {
  const entries: { number: number; label: "A" | "B" | "C" | "D"; text: string }[] = [];
  for (const match of line.matchAll(ANSWER_ENTRY_PATTERN)) {
    const number = Number(match[1]);
    const text = (match[3] || "").trim();
    if (!Number.isFinite(number) || number <= 0) continue;
    entries.push({
      number,
      label: match[2] as "A" | "B" | "C" | "D",
      text,
    });
  }
  return entries.filter((entry, index, all) =>
    all.findIndex((candidate) => candidate.number === entry.number) === index
  );
}

function answerKeyContext(source: MaterialQuestionSource, context: Context): string {
  if (source === "exam_question") return `exam:${context.examNumber ?? "unknown"}`;
  return `chapter:${context.chapterNumber ?? "unknown"}`;
}

function cloneContext(context: Context): Context {
  return { ...context };
}

function cloneRawQuestion(raw: RawQuestion): RawQuestion {
  return {
    promptLines: [...raw.promptLines],
    options: Object.fromEntries(
      Object.entries(raw.options).map(([id, lines]) => [id, [...(lines || [])]])
    ) as Partial<Record<"A" | "B" | "C" | "D", string[]>>,
    answerLabels: [...raw.answerLabels],
    explanationLines: [...raw.explanationLines],
    source: raw.source,
    questionNumber: raw.questionNumber,
    context: cloneContext(raw.context),
    lineStart: raw.lineStart,
    lineEnd: raw.lineEnd,
  };
}

function contextForAnswerKey(context: Context): { source: MaterialQuestionSource; context: Context } {
  if (context.examNumber && context.sectionTitle?.startsWith("Sample Exam")) {
    return { source: "exam_question", context: cloneContext(context) };
  }
  return { source: "chapter_question", context: cloneContext(context) };
}

function isSectionStart(line: string): boolean {
  return Boolean(parseChapter(line) || parseSampleExam(line) || /^Chapter Quiz$/i.test(line) || /^Sample Questions/i.test(line));
}

function shouldStopAnswerKeyCollection(line: string, answerKey: { source: MaterialQuestionSource; context: Context }, seenEntries: number): boolean {
  if (parseChapter(line)) return true;

  const examNumber = parseSampleExam(line);
  if (examNumber && (answerKey.source !== "exam_question" || examNumber !== answerKey.context.examNumber)) return true;

  return seenEntries > 0 && isAnswerKeyHeading(line);
}

function collectWindowedAnswerKeys(lines: SourceLine[]): Map<string, Map<number, AnswerEntry>> {
  const answerKeys = new Map<string, Map<number, AnswerEntry>>();
  const context: Context = {
    chapterNumber: null,
    chapterTitle: null,
    examNumber: null,
    sectionTitle: null,
  };
  const answerKeyContexts: { index: number; source: MaterialQuestionSource; context: Context }[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].text;
    const chapter = parseChapter(line);
    const examNumber = parseSampleExam(line);
    if (chapter) {
      context.chapterNumber = chapter.number;
      context.chapterTitle = chapter.title;
      context.sectionTitle = line;
    } else if (examNumber) {
      context.examNumber = examNumber;
      context.sectionTitle = line;
    } else if (/^Chapter Quiz$/i.test(line) || /^Sample Questions/i.test(line)) {
      context.sectionTitle = line;
    } else if (isAnswerKeyHeading(line)) {
      const answerKey = contextForAnswerKey(context);
      answerKeyContexts.push({ index, source: answerKey.source, context: answerKey.context });
    }
  }

  for (const answerKey of answerKeyContexts) {
    const key = answerKeyContext(answerKey.source, answerKey.context);
    const map = answerKeys.get(key) || new Map<number, AnswerEntry>();
    answerKeys.set(key, map);

    const backwardStart = Math.max(0, answerKey.index - 24);
    const forwardEnd = Math.min(lines.length - 1, answerKey.index + (answerKey.source === "exam_question" ? 900 : 600));
    let currentNumber: number | null = null;
    let seenEntries = 0;

    for (let index = backwardStart; index <= forwardEnd; index += 1) {
      if (index !== answerKey.index && index > answerKey.index && shouldStopAnswerKeyCollection(lines[index].text, answerKey, seenEntries)) break;
      if (isAnswerKeyHeading(lines[index].text)) continue;

      const entries = answerKeyEntriesFromLine(lines[index].text)
        .filter((entry) => answerKey.source === "exam_question" ? entry.number <= 250 : entry.number <= 40);
      if (entries.length > 0) {
        for (const entry of entries) {
          const existing = map.get(entry.number);
          const explanation = entry.text || existing?.explanation || "";
          map.set(entry.number, {
            labels: [entry.label],
            explanation: explanation.trim(),
          });
          currentNumber = entry.number;
          seenEntries += 1;
        }
        continue;
      }

      if (index < answerKey.index) continue;
      if (currentNumber && seenEntries > 0) {
        const existing = map.get(currentNumber);
        if (existing && lines[index].text.length > 0 && !/^\[PDF_(PAGE|SOURCE)\b/.test(lines[index].text)) {
          existing.explanation = `${existing.explanation} ${lines[index].text}`.trim();
        }
      }
    }
  }

  return answerKeys;
}

function makeRawQuestion(source: MaterialQuestionSource, context: Context, line: SourceLine, questionNumber: number | null, text: string): RawQuestion {
  return {
    promptLines: text ? [text] : [],
    options: {},
    answerLabels: [],
    explanationLines: [],
    source,
    questionNumber,
    context: { ...context },
    lineStart: line.number,
    lineEnd: line.number,
  };
}

function hasCompleteOptions(question: RawQuestion): boolean {
  return OPTION_IDS.every((id) => (question.options[id] || []).join(" ").trim().length > 0);
}

function shouldStartNewQuestion(current: RawQuestion, line: SourceLine, upcoming: SourceLine[]): boolean {
  if (!hasCompleteOptions(current)) return false;
  if (current.source === "example_question" && !current.answerLabels.length) return false;
  if (optionMatch(line.text) || answerMatch(line.text)) return false;
  if (/^[A-D]$/i.test(line.text)) return false;
  if (line.text.length < 12) return false;
  return upcoming.slice(0, 5).some((next) => optionMatch(next.text)?.id === "A");
}

function looksLikeNonQuestionMaterial(line: string): boolean {
  return /^(key point|note|objective|chapter|unit|lesson|syllabus|scope|exam|test|format|language|explanation|explain|japanese|english|n[1-5]\b)/i.test(line);
}

function repairFlagsForQuestion(
  question: string,
  options: { text: string }[],
  answerLabels: ("A" | "B" | "C" | "D")[],
  correctAnswers: number[]
): RepairFlag[] {
  const structuralText = `${question} ${options.map((option) => option.text).join(" ")}`;
  const flags: RepairFlag[] = [];
  if (options.length !== 4) flags.push("missing_or_extra_options");
  if (/\s+\d{1,3}[.)]\s+[A-Z][^.?!]{15,}/.test(question)) flags.push("merged_numbered_question");
  if (/\bA[.)]\s+[^B]+B[.)]\s+[^C]+C[.)]/.test(question)) flags.push("prompt_contains_options");
  if (options.some((option) => option.text.length > 420 || /\s+\d{1,3}[.)]\s+[A-Z]/.test(option.text) || /[.!?]\s+[A-D][.)]\s+/.test(option.text))) flags.push("option_swallowed_text");
  if (question.length < 12) flags.push("too_short_prompt");
  if (/would The owner|B\. Riparian rights are water rights|\[PDF_(PAGE|SOURCE)\b|fi(?:\s+fi){2,}|fl(?:\s+fi|\s+fl){2,}/i.test(structuralText)) {
    flags.push("explicit_ocr_layout_pollution");
  }
  if (answerLabels.length === 0) flags.push("no_answer_label");
  if (answerLabels.length > 0 && correctAnswers.length !== answerLabels.length) {
    flags.push("answer_label_not_in_options");
  }
  return Array.from(new Set(flags));
}

function hasStructuralPollution(question: string, options: { text: string }[]): boolean {
  return repairFlagsForQuestion(question, options, [], [])
    .some((flag) => !["no_answer_label", "answer_label_not_in_options"].includes(flag));
}

function repairActionsForFlags(flags: RepairFlag[]): RepairAction[] {
  const actions: Record<RepairFlag, RepairAction> = {
    missing_or_extra_options: makeRepairAction("recover_options_from_source_context", "pending", "Recover missing A/B/C/D options from nearby page or line context."),
    merged_numbered_question: makeRepairAction("split_merged_numbered_questions", "pending", "Split embedded numbered questions when neighboring option blocks support the split."),
    prompt_contains_options: makeRepairAction("resegment_prompt_and_options", "pending", "Move inline A/B/C/D option markers out of the prompt."),
    option_swallowed_text: makeRepairAction("trim_swallowed_option_text", "pending", "Trim body, explanation, or next-question text swallowed into an option."),
    too_short_prompt: makeRepairAction("recover_prompt_from_previous_lines", "pending", "Recover the prompt from preceding source lines."),
    explicit_ocr_layout_pollution: makeRepairAction("repair_ocr_layout_pollution", "pending", "Remove page markers, OCR ligature artifacts, or obvious cross-column pollution."),
    answer_label_not_in_options: makeRepairAction("repair_answer_option_mapping", "pending", "Repair answer label mapping after option recovery."),
    no_answer_label: makeRepairAction("retry_answer_key_lookup", "pending", "Retry answer key matching with broader chapter or exam context."),
    model_audit_structure: makeRepairAction("repair_from_source", "pending", "Model audit found an incomplete prompt or corrupted options; re-extract from the source page."),
    model_audit_key_disputed: makeRepairAction("confirm_answer_key", "pending", "Model audit disputes the answer key; confirm against the source answer key."),
  };
  return flags.map((flag) => ({ ...actions[flag] }));
}

function makeRepairAction(type: string, status: RepairAction["status"], note: string): RepairAction {
  return { type, status, note };
}

function rawQuestionText(raw: RawQuestion): string {
  return cleanQuestionText(raw.promptLines);
}

function rawOptions(raw: RawQuestion): { id: "A" | "B" | "C" | "D"; text: string }[] {
  return OPTION_IDS
    .map((id) => ({ id, text: cleanExtractedText((raw.options[id] || []).join(" ")) }))
    .filter((option) => option.text.length > 0);
}

function flagsForRaw(raw: RawQuestion): RepairFlag[] {
  const options = rawOptions(raw);
  const correctAnswers = raw.answerLabels
    .map((label) => options.findIndex((option) => option.id === label))
    .filter((index) => index >= 0);
  return repairFlagsForQuestion(rawQuestionText(raw), options, raw.answerLabels, correctAnswers);
}

function linesNearRaw(raw: RawQuestion, lines: SourceLine[], before: number, after: number): SourceLine[] {
  return lines.filter((line) => line.number >= raw.lineStart - before && line.number <= raw.lineEnd + after);
}

function repairOcrLayoutPollution(raw: RawQuestion): RepairFunctionResult {
  const repaired = cloneRawQuestion(raw);
  const cleanPart = (value: string) => value
    .replace(/\[PDF_PAGE\s+\d+\]/g, " ")
    .replace(/\[PDF_SOURCE[^\]]*\]/g, " ")
    .replace(/(?<!\w)fi\s+fi(?!\w)/gi, " ")
    .replace(/(?<!\w)fl\s+fl(?!\w)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const before = JSON.stringify(repaired);
  repaired.promptLines = repaired.promptLines.map(cleanPart).filter(Boolean);
  for (const id of OPTION_IDS) {
    if (repaired.options[id]) repaired.options[id] = repaired.options[id]?.map(cleanPart).filter(Boolean);
  }
  repaired.explanationLines = repaired.explanationLines.map(cleanPart).filter(Boolean);
  const modified = before !== JSON.stringify(repaired);
  return {
    modified,
    raw: repaired,
    actions: [makeRepairAction(
      "repair_ocr_layout_pollution",
      modified ? "applied" : "not_attempted",
      modified ? "Removed PDF layout markers or isolated ligature artifacts." : "No OCR layout pollution found."
    )],
  };
}

function optionMarkersFromInline(text: string): { id: "A" | "B" | "C" | "D"; index: number; markerLength: number }[] {
  return Array.from(text.matchAll(/\b([A-D])[.)]\s+/g))
    .map((match) => ({
      id: match[1] as "A" | "B" | "C" | "D",
      index: match.index ?? 0,
      markerLength: match[0].length,
    }))
    .filter((marker, index, markers) => markers.findIndex((candidate) => candidate.id === marker.id) === index)
    .sort((left, right) => left.index - right.index);
}

function resegmentPromptAndOptions(raw: RawQuestion): RepairFunctionResult {
  const text = raw.promptLines.join(" ").replace(/\s+/g, " ").trim();
  const markers = optionMarkersFromInline(text);
  const hasMinimumEvidence = ["A", "B", "C"].every((id) => markers.some((marker) => marker.id === id));
  if (!hasMinimumEvidence || markers[0]?.id !== "A") {
    return { modified: false, raw, actions: [makeRepairAction("resegment_prompt_and_options", "not_attempted", "Prompt does not contain enough inline option markers.")] };
  }
  const repaired = cloneRawQuestion(raw);
  repaired.promptLines = [text.slice(0, markers[0].index).trim()].filter(Boolean);
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const next = markers[index + 1];
    const optionText = text.slice(marker.index + marker.markerLength, next?.index ?? text.length).trim();
    if (optionText) repaired.options[marker.id] = [optionText];
  }
  return { modified: true, raw: repaired, actions: [makeRepairAction("resegment_prompt_and_options", "applied", "Moved inline prompt options into option fields.")] };
}

function splitMergedQuestion(raw: RawQuestion): { modified: boolean; raws: RawQuestion[]; actions: RepairAction[] } {
  const text = raw.promptLines.join(" ").replace(/\s+/g, " ").trim();
  const match = text.match(/\s+(\d{1,3})[.)]\s+[A-Z]/);
  if (!match || match.index === undefined || match.index < 12) {
    return { modified: false, raws: [raw], actions: [makeRepairAction("split_merged_numbered_questions", "not_attempted", "No embedded numbered question found.")] };
  }
  const nextNumber = Number(match[1]);
  if (raw.questionNumber !== null && nextNumber <= raw.questionNumber) {
    return { modified: false, raws: [raw], actions: [makeRepairAction("split_merged_numbered_questions", "failed", "Embedded question number is not sequential evidence.")] };
  }
  const first = cloneRawQuestion(raw);
  const second = cloneRawQuestion(raw);
  first.promptLines = [text.slice(0, match.index).trim()];
  second.promptLines = [text.slice(match.index).replace(/^\s*\d{1,3}[.)]\s+/, "").trim()];
  second.options = {};
  second.answerLabels = [];
  second.explanationLines = [];
  second.questionNumber = nextNumber;
  second.lineStart = raw.lineEnd;
  return { modified: true, raws: [first, second], actions: [makeRepairAction("split_merged_numbered_questions", "applied", "Split embedded numbered question into a new candidate.")] };
}

function trimSwallowedOptionText(raw: RawQuestion): RepairFunctionResult {
  const repaired = cloneRawQuestion(raw);
  let modified = false;
  for (const id of OPTION_IDS) {
    const current = (repaired.options[id] || []).join(" ").replace(/\s+/g, " ").trim();
    if (!current) continue;
    const optionBoundary = current.search(/[.!?]\s+[A-D][.)]\s+/);
    const boundaries = [
      current.search(/\s+\d{1,3}[.)]\s+[A-Z]/),
      optionBoundary >= 0 ? optionBoundary + 1 : -1,
      current.length > 420 ? current.slice(0, 420).lastIndexOf(" ") : -1,
    ].filter((index) => index > 2);
    if (boundaries.length === 0) continue;
    repaired.options[id] = [current.slice(0, Math.min(...boundaries)).trim()];
    modified = true;
  }
  return {
    modified,
    raw: repaired,
    actions: [makeRepairAction(
      "trim_swallowed_option_text",
      modified ? "applied" : "not_attempted",
      modified ? "Trimmed swallowed next-question or option text." : "No swallowed option text found."
    )],
  };
}

function recoverOptionsFromSourceContext(raw: RawQuestion, lines: SourceLine[]): RepairFunctionResult {
  const missing = OPTION_IDS.filter((id) => !(raw.options[id] || []).join(" ").trim());
  if (missing.length === 0) {
    return { modified: false, raw, actions: [makeRepairAction("recover_options_from_source_context", "not_attempted", "All options already present.")] };
  }
  const repaired = cloneRawQuestion(raw);
  let currentId: "A" | "B" | "C" | "D" | null = null;
  for (const line of linesNearRaw(raw, lines, 8, 20)) {
    if (line.number > raw.lineEnd && numberedQuestionMatch(line.text)) break;
    if (line.number > raw.lineEnd && isSectionStart(line.text)) break;
    if (isAnswerKeyHeading(line.text)) break;
    const option = optionMatch(line.text);
    if (option) {
      currentId = option.id;
      if (missing.includes(option.id) && !(repaired.options[option.id] || []).join(" ").trim()) {
        repaired.options[option.id] = [option.text];
      }
      continue;
    }
    if (currentId && missing.includes(currentId) && repaired.options[currentId]?.length) {
      repaired.options[currentId]?.push(line.text);
    }
  }
  const modified = missing.some((id) => (repaired.options[id] || []).join(" ").trim().length > 0);
  return {
    modified,
    raw: repaired,
    actions: [makeRepairAction(
      "recover_options_from_source_context",
      modified ? "applied" : "failed",
      modified ? "Recovered missing option labels from nearby source lines." : "Could not recover missing option labels from source context."
    )],
  };
}

function recoverShortPrompt(raw: RawQuestion, lines: SourceLine[]): RepairFunctionResult {
  if (rawQuestionText(raw).length >= 12) {
    return { modified: false, raw, actions: [makeRepairAction("recover_prompt_from_previous_lines", "not_attempted", "Prompt is not too short.")] };
  }
  const candidates = lines
    .filter((line) => line.number >= raw.lineStart - 6 && line.number < raw.lineStart)
    .map((line) => line.text)
    .filter((line) => line.length >= 12 && !optionMatch(line) && !answerKeyEntryMatch(line) && !isSectionStart(line) && !isAnswerKeyHeading(line));
  const recovered = candidates.find((line) => /\?$/.test(line)) || candidates[candidates.length - 1];
  if (!recovered) {
    return { modified: false, raw, actions: [makeRepairAction("recover_prompt_from_previous_lines", "failed", "Could not find a preceding prompt line.")] };
  }
  const repaired = cloneRawQuestion(raw);
  repaired.promptLines = [recovered];
  return { modified: true, raw: repaired, actions: [makeRepairAction("recover_prompt_from_previous_lines", "applied", "Recovered short prompt from previous source lines.")] };
}

function normalizedTokenSet(value: string): Set<string> {
  return new Set(value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token.length > 2));
}

function repairAnswerOptionMapping(raw: RawQuestion): RepairFunctionResult {
  const explanation = cleanExtractedText(raw.explanationLines.join(" "));
  if (!explanation || raw.answerLabels.every((label) => (raw.options[label] || []).join(" ").trim())) {
    return { modified: false, raw, actions: [makeRepairAction("repair_answer_option_mapping", "not_attempted", "Answer label already maps to an option or no answer text exists.")] };
  }
  const answerTokens = normalizedTokenSet(explanation);
  let best: { id: "A" | "B" | "C" | "D"; score: number } | null = null;
  for (const option of rawOptions(raw)) {
    const optionTokens = normalizedTokenSet(option.text);
    const overlap = [...optionTokens].filter((token) => answerTokens.has(token)).length;
    const score = optionTokens.size > 0 ? overlap / optionTokens.size : 0;
    if (!best || score > best.score) best = { id: option.id, score };
  }
  if (!best || best.score < 0.6) {
    return { modified: false, raw, actions: [makeRepairAction("repair_answer_option_mapping", "failed", "Could not fuzzy-match answer text to an option.")] };
  }
  const repaired = cloneRawQuestion(raw);
  repaired.answerLabels = [best.id];
  return { modified: true, raw: repaired, actions: [makeRepairAction("repair_answer_option_mapping", "applied", "Mapped answer text to the closest option by token overlap.")] };
}

function retryAnswerKeyLookup(raw: RawQuestion, answerKeys: Map<string, Map<number, AnswerEntry>>): RepairFunctionResult {
  if (raw.answerLabels.length > 0 || !raw.questionNumber) {
    return { modified: false, raw, actions: [makeRepairAction("retry_answer_key_lookup", "not_attempted", "Answer label already present or question has no number.")] };
  }
  const keys = [
    answerKeyContext(raw.source, raw.context),
    answerKeyContext(raw.source === "exam_question" ? "chapter_question" : "exam_question", raw.context),
    `chapter:${raw.context.chapterNumber ?? "unknown"}`,
    `exam:${raw.context.examNumber ?? "unknown"}`,
  ];
  for (const key of Array.from(new Set(keys))) {
    const entry = answerKeys.get(key)?.get(raw.questionNumber);
    if (!entry) continue;
    const repaired = cloneRawQuestion(raw);
    repaired.answerLabels = entry.labels;
    if (entry.explanation) repaired.explanationLines = [entry.explanation];
    return { modified: true, raw: repaired, actions: [makeRepairAction("retry_answer_key_lookup", "applied", `Recovered answer key from ${key}.`)] };
  }
  return { modified: false, raw, actions: [makeRepairAction("retry_answer_key_lookup", "failed", "No broader answer key context matched this question.")] };
}

function executeRepairs(raw: RawQuestion, flags: RepairFlag[], lines: SourceLine[], answerKeys: Map<string, Map<number, AnswerEntry>>): RepairExecutionResult {
  let candidates = [{ raw: cloneRawQuestion(raw), actions: [] as RepairAction[] }];
  const runSingle = (repair: (candidate: RawQuestion) => RepairFunctionResult) => {
    candidates = candidates.map((candidate) => {
      const result = repair(candidate.raw);
      return { raw: result.raw, actions: [...candidate.actions, ...result.actions] };
    });
  };
  runSingle(repairOcrLayoutPollution);
  runSingle(resegmentPromptAndOptions);
  candidates = candidates.flatMap((candidate) => {
    const result = splitMergedQuestion(candidate.raw);
    return result.raws.map((splitRaw) => ({ raw: splitRaw, actions: [...candidate.actions, ...result.actions] }));
  });
  runSingle(trimSwallowedOptionText);
  candidates = candidates.map((candidate) => {
    const result = recoverOptionsFromSourceContext(candidate.raw, lines);
    return { raw: result.raw, actions: [...candidate.actions, ...result.actions] };
  });
  candidates = candidates.map((candidate) => {
    const result = recoverShortPrompt(candidate.raw, lines);
    return { raw: result.raw, actions: [...candidate.actions, ...result.actions] };
  });
  runSingle(repairAnswerOptionMapping);
  candidates = candidates.map((candidate) => {
    const result = retryAnswerKeyLookup(candidate.raw, answerKeys);
    return { raw: result.raw, actions: [...candidate.actions, ...result.actions] };
  });
  const relevantActionTypes = new Set(repairActionsForFlags(flags).map((action) => action.type));
  return {
    raws: candidates.map((candidate) => candidate.raw),
    actionsByRaw: candidates.map((candidate) => candidate.actions.filter((action) => relevantActionTypes.has(action.type) || action.status === "applied")),
  };
}

function finalizeRawQuestion(rawQuestions: RawQuestion[], current: RawQuestion | null): RawQuestion | null {
  if (!current) return null;
  const prompt = cleanQuestionText(current.promptLines);
  if (prompt && Object.keys(current.options).length >= 2) {
    rawQuestions.push(current);
  }
  return null;
}

function normalizeRawQuestion(raw: RawQuestion, filePath: string, sequence: number, repairActions: RepairAction[] = []): MaterialQuestion {
  const question = cleanQuestionText(raw.promptLines);
  const options = OPTION_IDS
    .map((id) => ({ id, text: cleanExtractedText((raw.options[id] || []).join(" ")) }))
    .filter((option) => option.text.length > 0);
  const answerExplanation = cleanExtractedText(raw.explanationLines.join(" ")) || null;
  const correctAnswers = raw.answerLabels
    .map((label) => options.findIndex((option) => option.id === label))
    .filter((index) => index >= 0);
  const labels = [
    raw.source,
    raw.context.chapterTitle || null,
    raw.context.examNumber ? `Sample Exam ${raw.context.examNumber}` : null,
  ].filter((value): value is string => Boolean(value));
  const subtopicTags = raw.context.chapterTitle ? [raw.context.chapterTitle] : [];
  const contentHash = hashText(`${question}\n${options.map((option) => `${option.id}.${option.text}`).join("\n")}`);
  let confidence = 0.45;
  if (question.length > 20) confidence += 0.15;
  if (options.length === 4) confidence += 0.2;
  if (raw.answerLabels.length > 0 && correctAnswers.length === raw.answerLabels.length) confidence += 0.15;
  if (answerExplanation) confidence += 0.05;
  const repairFlags = repairFlagsForQuestion(question, options, raw.answerLabels, correctAnswers);
  const hasPollution = repairFlags.some((flag) =>
    !["no_answer_label", "answer_label_not_in_options"].includes(flag)
  );
  const isMalformed = options.length !== 4 || hasPollution;
  if (raw.answerLabels.length === 0 || correctAnswers.length === 0) confidence = Math.min(confidence, 0.75);
  if (options.length !== 4) confidence = Math.min(confidence, 0.75);
  if (hasPollution) confidence = Math.min(confidence, 0.75);
  confidence = Math.min(1, Number(confidence.toFixed(2)));
  const hasAppliedRepair = repairActions.some((action) => action.status === "applied");
  const reviewStatus: ReviewStatus = isMalformed
    ? "needs_repair"
    : repairFlags.includes("answer_label_not_in_options")
      ? "needs_repair"
      : repairFlags.includes("no_answer_label")
        ? "needs_user_review"
        : hasAppliedRepair
          ? "auto_repaired"
          : confidence >= 0.75
            ? "ready"
            : "needs_user_review";
  const finalRepairActions = repairActions.length > 0 ? repairActions : repairActionsForFlags(repairFlags);

  return {
    id: `material-${contentHash.slice(0, 16)}-${sequence}`,
    question,
    labels,
    source: raw.source,
    options,
    answerLabels: raw.answerLabels,
    correctAnswers,
    answerExplanation,
    chapter: {
      number: raw.context.chapterNumber,
      title: raw.context.chapterTitle,
    },
    exam: raw.source === "exam_question"
      ? {
          number: raw.context.examNumber,
          questionNumber: raw.questionNumber,
        }
      : null,
    subtopic: raw.context.chapterTitle,
    subtopicTags,
    confidence,
    reviewStatus,
    repairFlags,
    repairActions: finalRepairActions,
    rawCandidate: {
      question,
      options,
      answerLabels: raw.answerLabels,
    },
    sourceLocation: {
      filePath,
      lineStart: raw.lineStart,
      lineEnd: raw.lineEnd,
      sectionTitle: raw.context.sectionTitle,
    },
    contentHash,
    duplicateOf: null,
  };
}

async function classifySections(
  lines: SourceLine[],
  classifier: AiSectionClassifier | null,
  limit: number
): Promise<{ classified: number; failed: number }> {
  if (!classifier) return { classified: 0, failed: 0 };
  if (limit <= 0) return { classified: 0, failed: 0 };

  const candidates: { sectionTitle: string; source: MaterialQuestionSource; text: string }[] = [];
  let current: { sectionTitle: string; source: MaterialQuestionSource; text: string[] } | null = null;

  for (const line of lines) {
    const examNumber = parseSampleExam(line.text);
    let source: MaterialQuestionSource | null = null;
    if (/^Sample Questions/i.test(line.text)) source = "example_question";
    if (/^Chapter Quiz$/i.test(line.text)) source = "chapter_question";
    if (examNumber) source = "exam_question";
    if (isAnswerKeyHeading(line.text) || parseChapter(line.text)) {
      if (current) candidates.push({
        sectionTitle: current.sectionTitle,
        source: current.source,
        text: current.text.join("\n").slice(0, 3000),
      });
      current = null;
    }
    if (source) {
      if (current) candidates.push({
        sectionTitle: current.sectionTitle,
        source: current.source,
        text: current.text.join("\n").slice(0, 3000),
      });
      current = { sectionTitle: line.text, source, text: [] };
      continue;
    }
    if (current && current.text.join("\n").length < 3000) current.text.push(line.text);
  }
  if (current) candidates.push({
    sectionTitle: current.sectionTitle,
    source: current.source,
    text: current.text.join("\n").slice(0, 3000),
  });

  let classified = 0;
  let failed = 0;
  for (const candidate of candidates.slice(0, limit)) {
    try {
      await classifier.classify(candidate);
      classified += 1;
    } catch {
      failed += 1;
    }
  }
  return { classified, failed };
}

export async function extractMaterialQuestions(params: {
  filePath: string;
  text: string;
  classifier?: AiSectionClassifier | null;
  verifier?: MaterialQuestionVerifier | null;
  aiModel?: string | null;
  aiSectionLimit?: number;
}): Promise<MaterialExtractionResult> {
  const lines = params.text.split(/\r?\n/).map((text, index) => ({
    number: index + 1,
    text: normalizeLine(text),
  }));
  const normalizedLines = lines.filter((line) => !isNoiseLine(line.text));
  const answerKeys = collectWindowedAnswerKeys(normalizedLines);
  const rawQuestions: RawQuestion[] = [];
  const context: Context = {
    chapterNumber: null,
    chapterTitle: null,
    examNumber: null,
    sectionTitle: null,
  };
  let source: MaterialQuestionSource | null = null;
  let inAnswerKey = false;
  let currentQuestion: RawQuestion | null = null;
  let currentAnswerKeyNumber: number | null = null;
  let currentAnswerKeyMap: Map<number, AnswerEntry> | null = null;
  let currentAnswerKeySequence = 0;
  let currentQuestionSequence = 0;

  const aiClassification = await classifySections(
    normalizedLines,
    params.classifier || null,
    params.aiSectionLimit ?? 20
  );
  let aiVerifiedQuestions = 0;
  let aiFailedVerifications = 0;

  for (let index = 0; index < normalizedLines.length; index += 1) {
    const line = normalizedLines[index];
    const chapter = parseChapter(line.text);
    const examNumber = parseSampleExam(line.text);

    if (chapter) {
      currentQuestion = finalizeRawQuestion(rawQuestions, currentQuestion);
      context.chapterNumber = chapter.number;
      context.chapterTitle = chapter.title;
      context.sectionTitle = line.text;
      if (!inAnswerKey) source = null;
      continue;
    }

    if (/^Sample Questions/i.test(line.text)) {
      currentQuestion = finalizeRawQuestion(rawQuestions, currentQuestion);
      source = "example_question";
      inAnswerKey = false;
      context.sectionTitle = line.text;
      currentQuestionSequence = 0;
      continue;
    }

    if (/^Chapter Quiz$/i.test(line.text)) {
      currentQuestion = finalizeRawQuestion(rawQuestions, currentQuestion);
      source = "chapter_question";
      inAnswerKey = false;
      context.sectionTitle = line.text;
      currentQuestionSequence = 0;
      continue;
    }

    if (examNumber) {
      currentQuestion = finalizeRawQuestion(rawQuestions, currentQuestion);
      source = "exam_question";
      inAnswerKey = false;
      context.examNumber = examNumber;
      context.sectionTitle = line.text;
      currentQuestionSequence = 0;
      continue;
    }

    if (isAnswerKeyHeading(line.text)) {
      currentQuestion = finalizeRawQuestion(rawQuestions, currentQuestion);
      inAnswerKey = true;
      source = context.examNumber && context.sectionTitle?.startsWith("Sample Exam")
        ? "exam_question"
        : "chapter_question";
      const key = answerKeyContext(source, context);
      currentAnswerKeyMap = answerKeys.get(key) || new Map<number, AnswerEntry>();
      answerKeys.set(key, currentAnswerKeyMap);
      currentAnswerKeyNumber = null;
      currentAnswerKeySequence = 0;
      continue;
    }

    if (inAnswerKey && currentAnswerKeyMap) {
      const entries = answerKeyEntriesFromLine(line.text);
      if (entries.length > 0) {
        for (const entry of entries) {
          currentAnswerKeySequence = Math.max(currentAnswerKeySequence, entry.number);
          const existing = currentAnswerKeyMap.get(entry.number);
          currentAnswerKeyMap.set(entry.number, {
            labels: [entry.label],
            explanation: (entry.text || existing?.explanation || "").trim(),
          });
          currentAnswerKeyNumber = entry.number;
        }
        continue;
      }
      const standaloneLabel = line.text.match(/^([A-D])$/i);
      if (standaloneLabel) {
        currentAnswerKeySequence += 1;
        currentAnswerKeyMap.set(currentAnswerKeySequence, {
          labels: [standaloneLabel[1].toUpperCase() as "A" | "B" | "C" | "D"],
          explanation: "",
        });
        currentAnswerKeyNumber = currentAnswerKeySequence;
        continue;
      }
      if (currentAnswerKeyNumber) {
        const existing = currentAnswerKeyMap.get(currentAnswerKeyNumber);
        if (existing && line.text.length > 0) {
          existing.explanation = `${existing.explanation} ${line.text}`.trim();
        }
      }
      continue;
    }

    if (!source) continue;

    const numbered = numberedQuestionMatch(line.text);
    if (numbered && (source === "chapter_question" || source === "exam_question")) {
      currentQuestion = finalizeRawQuestion(rawQuestions, currentQuestion);
      currentQuestionSequence = Math.max(currentQuestionSequence, numbered.number);
      currentQuestion = makeRawQuestion(source, context, line, numbered.number, numbered.text);
      continue;
    }

    const upcoming = normalizedLines.slice(index + 1, index + 7);
    if (currentQuestion && shouldStartNewQuestion(currentQuestion, line, upcoming)) {
      currentQuestion = finalizeRawQuestion(rawQuestions, currentQuestion);
      currentQuestionSequence += 1;
      currentQuestion = makeRawQuestion(source, context, line, currentQuestionSequence, line.text);
      continue;
    }

    if (!currentQuestion) {
      if (!optionMatch(line.text)) {
        currentQuestionSequence += 1;
        currentQuestion = makeRawQuestion(source, context, line, currentQuestionSequence, line.text);
      }
      continue;
    }

    const option = optionMatch(line.text);
    const answer = hasCompleteOptions(currentQuestion) ? answerMatch(line.text) : null;

    if (
      currentQuestion.answerLabels.length > 0 &&
      !option &&
      looksLikeNonQuestionMaterial(line.text)
    ) {
      currentQuestion = finalizeRawQuestion(rawQuestions, currentQuestion);
      source = null;
      continue;
    }

    currentQuestion.lineEnd = line.number;

    if (answer && currentQuestion.answerLabels.length === 0) {
      currentQuestion.answerLabels = answer.labels;
      if (answer.text) currentQuestion.explanationLines.push(answer.text);
      continue;
    }

    if (option && currentQuestion.answerLabels.length === 0) {
      currentQuestion.options[option.id] = [option.text];
      continue;
    }

    if (option && currentQuestion.answerLabels.length > 0 && source === "example_question") {
      currentQuestion = finalizeRawQuestion(rawQuestions, currentQuestion);
      currentQuestionSequence += 1;
      currentQuestion = makeRawQuestion(source, context, line, currentQuestionSequence, "");
      currentQuestion.options[option.id] = [option.text];
      continue;
    }

    if (currentQuestion.answerLabels.length > 0) {
      currentQuestion.explanationLines.push(line.text);
      continue;
    }

    const optionIds = OPTION_IDS.filter((id) => currentQuestion?.options[id]);
    const lastOption = optionIds[optionIds.length - 1];
    if (lastOption) {
      currentQuestion.options[lastOption]?.push(line.text);
    } else {
      currentQuestion.promptLines.push(line.text);
    }
  }

  finalizeRawQuestion(rawQuestions, currentQuestion);

  for (const raw of rawQuestions) {
    if (raw.answerLabels.length > 0 || !raw.questionNumber) continue;
    const key = answerKeyContext(raw.source, raw.context);
    const entry = answerKeys.get(key)?.get(raw.questionNumber);
    if (entry) {
      raw.answerLabels = entry.labels;
      if (entry.explanation) raw.explanationLines = [entry.explanation];
    }
  }

  if (params.verifier) {
    const candidates = rawQuestions.filter((raw) => {
      const question = cleanQuestionText(raw.promptLines);
      const options = OPTION_IDS.map((id) => ({ text: cleanExtractedText((raw.options[id] || []).join(" ")) }));
      return raw.answerLabels.length === 0 && hasCompleteOptions(raw) && !hasStructuralPollution(question, options);
    });
    const concurrency = Math.max(1, Number(process.env.MATERIAL_AI_VERIFY_CONCURRENCY || 5));
    let nextIndex = 0;
    const verifyNext = async () => {
      while (nextIndex < candidates.length) {
        const raw = candidates[nextIndex];
        nextIndex += 1;
        const nearbyText = normalizedLines
          .filter((line) => line.number >= raw.lineStart - 12 && line.number <= raw.lineEnd + 80)
          .map((line) => line.text)
          .join("\n")
          .slice(0, 5000);
        try {
          const verified = await params.verifier?.verify({
            question: cleanQuestionText(raw.promptLines),
            options: OPTION_IDS.map((id) => ({ id, text: cleanExtractedText((raw.options[id] || []).join(" ")) })),
            source: raw.source,
            chapterTitle: raw.context.chapterTitle,
            sectionTitle: raw.context.sectionTitle,
            nearbyText,
          });
          if (verified && verified.confidence >= 0.72 && verified.answerLabels.length > 0) {
            raw.answerLabels = verified.answerLabels;
            if (verified.explanation) raw.explanationLines = [verified.explanation];
            aiVerifiedQuestions += 1;
          } else {
            aiFailedVerifications += 1;
          }
        } catch {
          aiFailedVerifications += 1;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, verifyNext));
  }

  const repairedQuestions = rawQuestions.flatMap((raw) => {
    const flags = flagsForRaw(raw);
    const result = executeRepairs(raw, flags, normalizedLines, answerKeys);
    return result.raws.map((repairedRaw, index) => ({
      raw: repairedRaw,
      actions: result.actionsByRaw[index] || [],
    }));
  });

  const questions = repairedQuestions
    .map((candidate, index) => normalizeRawQuestion(candidate.raw, params.filePath, index + 1, candidate.actions))
    .filter((question) => question.question.length > 0 && question.options.length >= 2);

  const seenHashes = new Map<string, string>();
  for (const question of questions) {
    const existingId = seenHashes.get(question.contentHash);
    if (existingId) {
      question.duplicateOf = existingId;
    } else {
      seenHashes.set(question.contentHash, question.id);
    }
  }

  const reviewItems = buildReviewItems(questions);

  const bySource: Record<MaterialQuestionSource, number> = {
    example_question: 0,
    chapter_question: 0,
    exam_question: 0,
  };
  for (const question of questions) bySource[question.source] += 1;

  return {
    questions,
    reviewItems,
    report: {
      generatedAt: new Date().toISOString(),
      inputFiles: [params.filePath],
      totalQuestions: questions.length,
      readyQuestions: questions.filter((question) => question.reviewStatus === "ready").length,
      autoRepairedQuestions: questions.filter((question) => question.reviewStatus === "auto_repaired").length,
      needsRepairQuestions: questions.filter((question) => question.reviewStatus === "needs_repair").length,
      needsUserReviewQuestions: reviewItems.length,
      unresolvedQuestions: questions.filter((question) => question.reviewStatus === "unresolved").length,
      manualReviewRate: questions.length > 0 ? Number((reviewItems.length / questions.length).toFixed(4)) : 0,
      repairDebtRate: questions.length > 0
        ? Number((questions.filter((question) =>
            question.reviewStatus === "needs_repair" || question.reviewStatus === "unresolved"
          ).length / questions.length).toFixed(4))
        : 0,
      duplicateQuestions: questions.filter((question) => question.duplicateOf).length,
      unmatchedAnswerQuestions: questions.filter((question) => question.answerLabels.length === 0).length,
      bySource,
      ai: {
        enabled: Boolean(params.classifier || params.verifier),
        model: params.aiModel || null,
        classifiedSections: aiClassification.classified,
        failedSections: aiClassification.failed,
        verifiedQuestions: aiVerifiedQuestions,
        failedVerifications: aiFailedVerifications,
      },
    },
  };
}
