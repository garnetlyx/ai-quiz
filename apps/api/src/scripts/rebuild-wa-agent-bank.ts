import "../env.js";
import { existsSync } from "fs";
import { readFile, readdir, writeFile } from "fs/promises";
import path from "path";
import { client } from "../db/index.js";
import { extractMaterialQuestions, type MaterialQuestion } from "../services/materialExtraction.js";
import { buildMaterialQuestionVerifier } from "../services/materialVerification.js";
import { extractPdfLayoutText } from "../services/pdfLayoutText.js";
import {
  applyModelAudit,
  buildKnownWordPredicate,
  buildReviewItems,
  mergeQuestionBanks,
  type MaterialAuditRecord,
} from "../services/materialBank.js";
import { importMaterialQuestions, validatedReviewStatus } from "../services/materialImport.js";
import { applyMaterialRepairs } from "../services/materialRepairs.js";
import { parsePracticeTests } from "./extract-practice-tests.js";

const DEFAULT_PDF_DIR = "data/wa-agent/pdf";
const DEFAULT_OUTPUT_DIR = "data/wa-agent/export";
const PRACTICE_TESTS_LABEL = "data/wa-agent/4-exams";
const DEFAULT_OVERRIDES_FILE = "data/wa-agent/export/verified-answer-overrides.json";
const DEFAULT_MODEL_AUDIT_FILE = "data/wa-agent/export/model-audit.json";
const DEFAULT_WORDLIST = "/usr/share/dict/words";

function repoRoot(): string {
  return path.resolve(process.cwd(), "../..");
}

function resolveFromRoot(value: string): string {
  return path.resolve(repoRoot(), value);
}

function getArg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

// Deterministic, idempotent rebuild of the WA agent question bank:
// per-PDF extraction (no AI) + practice tests, merged by contentHash, guarded
// for quiz eligibility, all artifacts written by the same run. Optionally
// imports the bank into a topic.
async function main() {
  const pdfDir = getArg("pdf-dir") || DEFAULT_PDF_DIR;
  const outputDir = getArg("output-dir") || DEFAULT_OUTPUT_DIR;
  const topicId = getArg("topic-id");
  const replaceExisting = getArg("replace-existing") === "true";
  const buildScope = getArg("build-scope") === "true";
  const legacySupplement = getArg("legacy-supplement");

  const outputDirAbs = resolveFromRoot(outputDir);
  const banks: MaterialQuestion[][] = [];
  const perSource: Record<string, unknown>[] = [];

  const verifier = process.env.MATERIAL_AI_VERIFY === "false" ? null : buildMaterialQuestionVerifier();

  const pdfFiles = (await readdir(resolveFromRoot(pdfDir)))
    .filter((file) => file.toLowerCase().endsWith(".pdf"))
    .sort();
  if (pdfFiles.length === 0) throw new Error(`No PDFs found in ${pdfDir}`);

  for (const pdfFile of pdfFiles) {
    const relativePath = `${pdfDir}/${pdfFile}`;
    console.error(`[rebuild] extracting ${relativePath}...`);
    const layout = await extractPdfLayoutText(resolveFromRoot(relativePath));
    console.error(`[rebuild] ${pdfFile}: layout done (${layout.diagnostics.pages} pages), parsing questions...`);
    const result = await extractMaterialQuestions({
      filePath: relativePath,
      text: layout.text,
      verifier,
      aiSectionLimit: 0,
    });
    banks.push(result.questions);
    perSource.push({
      file: relativePath,
      totalQuestions: result.report.totalQuestions,
      readyQuestions: result.report.readyQuestions,
      autoRepairedQuestions: result.report.autoRepairedQuestions,
      needsRepairQuestions: result.report.needsRepairQuestions,
      needsUserReviewQuestions: result.report.needsUserReviewQuestions,
    });
  }

  const practiceQuestions = await parsePracticeTests();
  banks.push(practiceQuestions);
  perSource.push({
    file: PRACTICE_TESTS_LABEL,
    totalQuestions: practiceQuestions.length,
    readyQuestions: practiceQuestions.filter((q) => q.reviewStatus === "ready").length,
    autoRepairedQuestions: practiceQuestions.filter((q) => q.reviewStatus === "auto_repaired").length,
    needsRepairQuestions: practiceQuestions.filter((q) => q.reviewStatus === "needs_repair").length,
    needsUserReviewQuestions: practiceQuestions.filter((q) => q.reviewStatus === "needs_user_review").length,
  });

  if (legacySupplement) {
    const supplementPath = resolveFromRoot(legacySupplement);
    const supplementQuestions = JSON.parse(await readFile(supplementPath, "utf8")) as MaterialQuestion[];
    banks.push(supplementQuestions);
    perSource.push({
      file: legacySupplement,
      totalQuestions: supplementQuestions.length,
      readyQuestions: supplementQuestions.filter((q) => q.reviewStatus === "ready").length,
      autoRepairedQuestions: supplementQuestions.filter((q) => q.reviewStatus === "auto_repaired").length,
      needsRepairQuestions: supplementQuestions.filter((q) => q.reviewStatus === "needs_repair").length,
      needsUserReviewQuestions: supplementQuestions.filter((q) => q.reviewStatus === "needs_user_review").length,
    });
  }

  // A word list lets the merge route unreadable OCR garbage out of the quiz pool.
  const wordListPath = process.env.MATERIAL_WORDLIST || DEFAULT_WORDLIST;
  if (!existsSync(wordListPath)) throw new Error(`Word list not found at ${wordListPath}; set MATERIAL_WORDLIST`);
  const wordList = new Set((await readFile(wordListPath, "utf8")).split("\n").map((word) => word.trim().toLowerCase()));
  const merged = mergeQuestionBanks(banks, { isKnownWord: buildKnownWordPredicate(wordList) });
  let questions = merged.questions.map((question) => ({
    ...question,
    reviewStatus: validatedReviewStatus(question),
  }));

  // Human-verified answers for records whose answers live only on scanned pages the
  // deterministic extractor cannot read. Keyed by contentHash; see the overrides file.
  const overridesFile = getArg("answer-overrides") || DEFAULT_OVERRIDES_FILE;
  const overridesPath = resolveFromRoot(overridesFile);
  let appliedOverrides = 0;
  if (existsSync(overridesPath)) {
    const overrides = JSON.parse(await readFile(overridesPath, "utf8")) as Array<{
      contentHash: string;
      answerLabels?: string[];
      correctAnswers?: number[];
      answerExplanation?: string;
      options?: { id: string; text: string }[];
      reviewStatus?: string;
      note: string;
    }>;
    const byHash = new Map(overrides.map((o) => [o.contentHash, o]));
    for (const question of questions) {
      const override = byHash.get(question.contentHash);
      if (!override) continue;
      if (override.options) question.options = override.options as typeof question.options;
      if (override.answerLabels) question.answerLabels = override.answerLabels as typeof question.answerLabels;
      if (override.correctAnswers) question.correctAnswers = override.correctAnswers;
      if (override.answerExplanation) question.answerExplanation = override.answerExplanation;
      question.reviewStatus = (override.reviewStatus as typeof question.reviewStatus) || "auto_repaired";
      question.repairActions = [...(question.repairActions || []), {
        type: "verified_answer_override",
        status: "applied",
        note: override.note,
      }];
      appliedOverrides += 1;
    }
  }

  // Content recovery and AI adaptations retain their source evidence and must
  // be audited under their new fingerprints before importing the rebuilt bank.
  const contentRepairsPath = getArg("content-repairs");
  let appliedContentRepairs = 0;
  if (contentRepairsPath) {
    const repairs = JSON.parse(await readFile(resolveFromRoot(contentRepairsPath), "utf8"));
    const repaired = applyMaterialRepairs(questions, repairs);
    questions = repaired.questions;
    appliedContentRepairs = repaired.applied;
  }

  // Model audit verdicts (see audit-material-bank.ts) gate what reaches quizzes:
  // incomplete/corrupted records and disputed keys leave the servable pool.
  const modelAuditPath = resolveFromRoot(getArg("model-audit") || DEFAULT_MODEL_AUDIT_FILE);
  let modelAuditStats: ReturnType<typeof applyModelAudit>["stats"] | null = null;
  if (existsSync(modelAuditPath)) {
    const audits = JSON.parse(await readFile(modelAuditPath, "utf8")) as MaterialAuditRecord[];
    const audited = applyModelAudit(questions, audits);
    questions = audited.questions;
    modelAuditStats = audited.stats;
  }

  const writeJson = async (name: string, value: unknown) => {
    await writeFile(path.join(outputDirAbs, name), `${JSON.stringify(value, null, 2)}\n`);
  };
  await writeJson("material-questions.json", questions);
  await writeJson("practice-test-questions.json", practiceQuestions);
  await writeJson("material-review-items.json", buildReviewItems(questions));
  await writeJson("material-extraction-report.json", {
    generatedAt: new Date().toISOString(),
    inputFiles: [...pdfFiles.map((file) => `${pdfDir}/${file}`), PRACTICE_TESTS_LABEL],
    pipeline: "per-PDF deterministic extraction + practice tests, merged by contentHash",
    totalQuestions: questions.length,
    duplicateQuestions: merged.duplicateCount,
    readyQuestions: questions.filter((q) => q.reviewStatus === "ready").length,
    autoRepairedQuestions: questions.filter((q) => q.reviewStatus === "auto_repaired").length,
    needsRepairQuestions: questions.filter((q) => q.reviewStatus === "needs_repair").length,
    needsUserReviewQuestions: questions.filter((q) => q.reviewStatus === "needs_user_review").length,
    modelAudit: modelAuditStats,
    appliedContentRepairs,
    perSource,
  });

  let importResult: Awaited<ReturnType<typeof importMaterialQuestions>> | null = null;
  if (topicId) {
    if (contentRepairsPath && (!modelAuditStats || modelAuditStats.unaudited > 0)) {
      throw new Error("Content repairs require complete model audit coverage before import; audit the rebuilt file first");
    }
    importResult = await importMaterialQuestions({
      topicId,
      questions,
      replaceExisting,
      buildScope,
      fileName: "material-questions.json",
    });
  }
  await client.end();

  console.log(JSON.stringify({
    totalQuestions: questions.length,
    duplicateQuestions: merged.duplicateCount,
    appliedAnswerOverrides: appliedOverrides,
    appliedContentRepairs,
    modelAudit: modelAuditStats,
    bySource: perSource,
    import: importResult,
  }, null, 2));
}

main().catch(async (error) => {
  console.error(error);
  await client.end();
  process.exitCode = 1;
});
