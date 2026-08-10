import "../env.js";
import { createHash } from "crypto";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import type { MaterialQuestion, MaterialQuestionSource, RepairFlag, ReviewStatus } from "../services/materialExtraction.js";

interface Option {
  id: "A" | "B" | "C" | "D";
  text: string;
}

interface ParsedAnswer {
  number: number;
  label: "A" | "B" | "C" | "D" | null;
  explanation: string;
}

interface ParsedQuestion {
  number: number;
  prompt: string;
  options: Option[];
}

const OPTION_IDS: ("A" | "B" | "C" | "D")[] = ["A", "B", "C", "D"];
const EXAMS_DIR = "data/wa-agent/4-exams";
const OUTPUT_FILE = "data/wa-agent/practice-test-questions.json";

function repoRoot(): string {
  return path.resolve(process.cwd(), "../..");
}

function resolveFromRoot(value: string): string {
  return path.resolve(repoRoot(), value);
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cleanText(value: string): string {
  return value
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function splitPortions(text: string): { national: string[]; state: string[] } {
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  const nationalIdx = lines.findIndex((line) => /^\s*National Portion\s*$/i.test(line));
  const stateIdx = lines.findIndex((line) => /^\s*State Portion\s*$/i.test(line));
  const national = nationalIdx >= 0 ? lines.slice(nationalIdx + 1, stateIdx > nationalIdx ? stateIdx : lines.length) : [];
  const state = stateIdx >= 0 ? lines.slice(stateIdx + 1) : [];
  return { national, state };
}

function parseQuestions(lines: string[]): Map<number, ParsedQuestion> {
  const result = new Map<number, ParsedQuestion>();
  let current: (ParsedQuestion & { promptLines: string[] }) | null = null;
  let currentOptionId: "A" | "B" | "C" | "D" | null = null;

  const flush = () => {
    if (!current) return;
    current.prompt = cleanText(current.promptLines.join(" "));
    result.set(current.number, { number: current.number, prompt: current.prompt, options: current.options });
    current = null;
    currentOptionId = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) {
      if (current) currentOptionId = null;
      continue;
    }

    const questionMatch = line.match(/^\s*(\d{1,3})[.)]\s+(.+)$/);
    if (questionMatch && !/^([A-Da-d])(?:[a-z]?)[.)]/.test(line.trim())) {
      flush();
      current = { number: Number(questionMatch[1]), prompt: "", promptLines: [questionMatch[2]], options: [] };
      currentOptionId = null;
      continue;
    }

    if (!current) continue;

    const optionMatch = line.match(/^\s*([A-Da-d])(?:[a-z]?)[.)]\s*(.*)$/);
    if (optionMatch) {
      const id = optionMatch[1].toUpperCase() as "A" | "B" | "C" | "D";
      const text = optionMatch[2].trim();
      if (!current.options.some((opt) => opt.id === id)) {
        current.options.push({ id, text });
      } else if (text) {
        current.options.find((opt) => opt.id === id)!.text = cleanText(`${current.options.find((opt) => opt.id === id)!.text} ${text}`);
      }
      currentOptionId = id;
      continue;
    }

    if (currentOptionId) {
      const opt = current.options.find((o) => o.id === currentOptionId);
      if (opt) opt.text = cleanText(`${opt.text} ${line.trim()}`);
    } else {
      current.promptLines.push(line.trim());
    }
  }
  flush();
  return result;
}

function parseAnswerKey(lines: string[]): Map<number, ParsedAnswer> {
  const result = new Map<number, ParsedAnswer>();
  let current: ({ number: number; label: ParsedAnswer["label"]; explanationLines: string[] }) | null = null;

  const flush = () => {
    if (!current) return;
    const explanation = cleanText(current.explanationLines.join(" "));
    result.set(current.number, { number: current.number, label: current.label, explanation });
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) {
      if (current) current.explanationLines.push("");
      continue;
    }

    // Answers look like: "34. B) Some text" / "34. B. Some text" / "34) B Some text"
    const answerMatch = line.match(/^\s*(\d{1,3})[.)]\s*([A-D])[.)]?\s+(.+)$/);
    if (answerMatch) {
      flush();
      current = {
        number: Number(answerMatch[1]),
        label: answerMatch[2] as "A" | "B" | "C" | "D",
        explanationLines: [answerMatch[3]],
      };
      continue;
    }

    // Fallback: leading "34." with no letter (key may omit letter for corrected items)
    const bareMatch = line.match(/^\s*(\d{1,3})[.)]\s+(.+)$/);
    if (bareMatch && !result.has(Number(bareMatch[1]))) {
      flush();
      current = {
        number: Number(bareMatch[1]),
        label: null,
        explanationLines: [bareMatch[2]],
      };
      continue;
    }

    if (current) current.explanationLines.push(line.trim());
  }
  flush();
  return result;
}

function buildMaterialQuestion(params: {
  testNumber: number;
  portion: "National" | "State";
  question: ParsedQuestion;
  answer: ParsedAnswer | undefined;
  filePath: string;
  lineStart: number;
}): MaterialQuestion {
  const { testNumber, portion, question, answer, filePath, lineStart } = params;
  const options: Option[] = OPTION_IDS.map((id) => {
    const found = question.options.find((opt) => opt.id === id);
    return { id, text: found ? found.text : "" };
  }).filter((opt) => opt.text);

  const answerLabels: ("A" | "B" | "C" | "D")[] = answer?.label ? [answer.label] : [];
  const correctAnswers = answerLabels
    .map((label) => options.findIndex((opt) => opt.id === label))
    .filter((index) => index >= 0);

  const promptText = question.prompt || `(Practice Test ${testNumber} ${portion} #${question.number})`;
  const contentHash = hashText(`${promptText}\n${options.map((opt) => `${opt.id}.${opt.text}`).join("\n")}`);

  const hasAllOptions = options.length === 4;
  const hasAnswer = answerLabels.length > 0;
  const repairFlags: RepairFlag[] = [];
  if (!hasAllOptions) repairFlags.push("missing_or_extra_options");
  if (!hasAnswer) repairFlags.push("no_answer_label");
  if (answer?.label && !options.some((opt) => opt.id === answer.label)) {
    repairFlags.push("answer_label_not_in_options");
  }

  const reviewStatus: ReviewStatus = repairFlags.length === 0 ? "ready" : "needs_user_review";
  const source: MaterialQuestionSource = "exam_question";
  const labels = [`Practice Test ${testNumber}`, portion, `National Portion ${testNumber}`, portion];

  return {
    id: `pt-${testNumber}-${portion.toLowerCase()}-${question.number}`,
    question: promptText,
    labels,
    source,
    options: options as MaterialQuestion["options"],
    answerLabels,
    correctAnswers,
    answerExplanation: answer?.explanation || null,
    chapter: { number: null, title: `${portion} Portion` },
    exam: { number: testNumber, questionNumber: question.number },
    subtopic: portion,
    subtopicTags: [`Practice Test ${testNumber}`, portion],
    confidence: repairFlags.length === 0 ? 1 : 0.5,
    reviewStatus,
    repairFlags,
    repairActions: repairFlags.map((flag) => ({ type: `manual_review_${flag}`, status: "pending", note: "Parsed from practice test answer key file." })),
    rawCandidate: {
      question: promptText,
      options: options as MaterialQuestion["options"],
      answerLabels,
    },
    sourceLocation: {
      filePath,
      lineStart,
      lineEnd: lineStart,
      sectionTitle: `Practice Test ${testNumber} - ${portion}`,
    },
    contentHash,
    duplicateOf: null,
  };
}

async function parseTestFile(testNumber: number): Promise<MaterialQuestion[]> {
  const dir = resolveFromRoot(EXAMS_DIR);
  const questionsPath = path.join(dir, `Practice_Test_${testNumber}_Questions.txt`);
  const nationalKeyPath = path.join(dir, `Practice_Test_${testNumber}_AnswerKey_National.txt`);
  const stateKeyPath = path.join(dir, `Practice_Test_${testNumber}_AnswerKey_State.txt`);

  const questionsText = await readFile(questionsPath, "utf8");
  const { national: nationalQ, state: stateQ } = splitPortions(questionsText);
  const nationalQuestions = parseQuestions(nationalQ);
  const stateQuestions = parseQuestions(stateQ);

  const nationalAnswers = parseAnswerKey((await readFile(nationalKeyPath, "utf8")).split("\n"));
  const stateAnswers = parseAnswerKey((await readFile(stateKeyPath, "utf8")).split("\n"));

  const out: MaterialQuestion[] = [];
  let lineCursor = 1;
  for (const [number, question] of nationalQuestions) {
    out.push(buildMaterialQuestion({
      testNumber,
      portion: "National",
      question,
      answer: nationalAnswers.get(number),
      filePath: `${EXAMS_DIR}/Practice_Test_${testNumber}_Questions.txt`,
      lineStart: lineCursor,
    }));
    lineCursor += 1;
  }
  for (const [number, question] of stateQuestions) {
    out.push(buildMaterialQuestion({
      testNumber,
      portion: "State",
      question,
      answer: stateAnswers.get(number),
      filePath: `${EXAMS_DIR}/Practice_Test_${testNumber}_Questions.txt`,
      lineStart: lineCursor,
    }));
    lineCursor += 1;
  }
  return out;
}

async function main() {
  const all: MaterialQuestion[] = [];
  const stats: Record<number, { national: number; state: number; withAnswer: number; withAllOptions: number }> = {};
  for (const testNumber of [1, 2, 3, 4]) {
    const questions = await parseTestFile(testNumber);
    all.push(...questions);
    const national = questions.filter((q) => q.subtopic === "National").length;
    const state = questions.filter((q) => q.subtopic === "State").length;
    const withAnswer = questions.filter((q) => q.answerLabels.length > 0).length;
    const withAllOptions = questions.filter((q) => q.options.length === 4).length;
    stats[testNumber] = { national, state, withAnswer, withAllOptions };
  }

  // Deduplicate within practice tests by contentHash.
  const seen = new Map<string, MaterialQuestion>();
  for (const question of all) {
    if (!seen.has(question.contentHash)) seen.set(question.contentHash, question);
  }
  const unique = [...seen.values()];

  await writeFile(resolveFromRoot(OUTPUT_FILE), `${JSON.stringify(unique, null, 2)}\n`);
  console.log(JSON.stringify({
    totalParsed: all.length,
    uniqueAfterDedupe: unique.length,
    byTest: stats,
    ready: unique.filter((q) => q.reviewStatus === "ready").length,
    needsReview: unique.filter((q) => q.reviewStatus === "needs_user_review").length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
