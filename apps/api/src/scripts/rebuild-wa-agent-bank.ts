import "../env.js";
import { readdir, writeFile } from "fs/promises";
import path from "path";
import { client } from "../db/index.js";
import { extractMaterialQuestions, type MaterialQuestion } from "../services/materialExtraction.js";
import { extractPdfLayoutText } from "../services/pdfLayoutText.js";
import { buildReviewItems, mergeQuestionBanks } from "../services/materialBank.js";
import { importMaterialQuestions, validatedReviewStatus } from "../services/materialImport.js";
import { parsePracticeTests } from "./extract-practice-tests.js";

const DEFAULT_PDF_DIR = "data/wa-agent/pdf";
const DEFAULT_OUTPUT_DIR = "data/wa-agent";
const PRACTICE_TESTS_LABEL = "data/wa-agent/4-exams";

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

  const outputDirAbs = resolveFromRoot(outputDir);
  const banks: MaterialQuestion[][] = [];
  const perSource: Record<string, unknown>[] = [];

  const pdfFiles = (await readdir(resolveFromRoot(pdfDir)))
    .filter((file) => file.toLowerCase().endsWith(".pdf"))
    .sort();
  if (pdfFiles.length === 0) throw new Error(`No PDFs found in ${pdfDir}`);

  for (const pdfFile of pdfFiles) {
    const relativePath = `${pdfDir}/${pdfFile}`;
    const layout = await extractPdfLayoutText(resolveFromRoot(relativePath));
    const result = await extractMaterialQuestions({
      filePath: relativePath,
      text: layout.text,
      verifier: null,
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

  const merged = mergeQuestionBanks(banks);
  const questions = merged.questions.map((question) => ({
    ...question,
    reviewStatus: validatedReviewStatus(question),
  }));

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
    perSource,
  });

  let importResult: Awaited<ReturnType<typeof importMaterialQuestions>> | null = null;
  if (topicId) {
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
    bySource: perSource,
    import: importResult,
  }, null, 2));
}

main().catch(async (error) => {
  console.error(error);
  await client.end();
  process.exitCode = 1;
});
