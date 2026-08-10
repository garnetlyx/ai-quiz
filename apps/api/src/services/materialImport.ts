import { createHash, randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  materialImportJobs,
  materialQuestions,
  materialTextChunks,
  topics,
  topicUpdateSuggestions,
} from "../db/schema.js";
import { extractMaterialQuestions, type MaterialQuestion } from "./materialExtraction.js";
import { buildMaterialQuestionVerifier } from "./materialVerification.js";
import { extractPdfLayoutText } from "./pdfLayoutText.js";
import { ocrImageFile } from "./ocr.js";
import { normalizeMaterials, normalizeScope } from "./scope.js";
import type { MaterialChunkKind, TopicMaterials, TopicScope } from "@ai-quiz/shared";

const execFileAsync = promisify(execFile);
const QUEUE_NAME = "material-imports";

interface ImportJobData {
  jobId: string;
}

interface ClassifiedChunk {
  kind: MaterialChunkKind;
  content: string;
  labels: string[];
  confidence: number;
}

let queue: Queue<ImportJobData> | null = null;
let worker: Worker<ImportJobData> | null = null;

function uploadRoot(): string {
  return process.env.MATERIAL_UPLOAD_DIR || path.resolve(process.cwd(), "../../data/uploads");
}

function redisUrl(): string | null {
  return process.env.REDIS_URL || null;
}

function hashText(value: string): string {
  return createHash("sha256").update(value.toLowerCase().trim().replace(/[^\w\s]/g, "")).digest("hex");
}

function optionExplanations(question: MaterialQuestion) {
  return question.options.map((option, index) => ({
    optionId: option.id,
    isCorrect: question.correctAnswers.includes(index),
    explanation: question.answerExplanation || "",
  }));
}

function detectFileKind(mimeType: string, fileName: string): "pdf" | "image" | "text" {
  const lower = fileName.toLowerCase();
  if (mimeType.includes("pdf") || lower.endsWith(".pdf")) return "pdf";
  if (mimeType.startsWith("image/") || /\.(png|jpe?g|webp|tiff?)$/i.test(lower)) return "image";
  return "text";
}

async function extractImageText(filePath: string): Promise<string> {
  // Column-major OCR with optional LLM vision fallback (see services/ocr.ts).
  return ocrImageFile(filePath);
}

async function extractTextFromFile(filePath: string, mimeType: string, fileName: string): Promise<string> {
  const kind = detectFileKind(mimeType, fileName);
  if (kind === "pdf") return (await extractPdfLayoutText(filePath)).text;
  if (kind === "image") return extractImageText(filePath);
  return readFile(filePath, "utf8");
}

function splitParagraphs(text: string): { content: string; lineStart: number; lineEnd: number }[] {
  const paragraphs: { lines: string[]; lineStart: number; lineEnd: number }[] = [];
  let current: { lines: string[]; lineStart: number; lineEnd: number } | null = null;

  text.split(/\r?\n/).forEach((line, index) => {
    const lineNumber = index + 1;
    if (!line.trim()) {
      if (current) {
        paragraphs.push(current);
        current = null;
      }
      return;
    }

    if (!current) {
      current = { lines: [], lineStart: lineNumber, lineEnd: lineNumber };
    }
    current.lines.push(line);
    current.lineEnd = lineNumber;
  });

  if (current) paragraphs.push(current);

  return paragraphs
    .map((paragraph) => ({
      content: paragraph.lines.map((line) => line.replace(/\s+/g, " ").trim()).join("\n").trim(),
      lineStart: paragraph.lineStart,
      lineEnd: paragraph.lineEnd,
    }))
    .filter((paragraph) => paragraph.content.length >= 30)
    .slice(0, 200);
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

function classifyHelpfulChunk(chunk: string): ClassifiedChunk {
  const lower = chunk.toLowerCase();
  const isStructure =
    /syllabus|table of contents|chapter|unit|lesson|objective|outline|subtopic|scope/.test(lower) ||
    /(^|\n)(\d+\.|[ivx]+\.)\s+/i.test(chunk);
  const isDefinition =
    /(\b(exam|test|level|explanation|explain|language|bilingual|japanese|english|n2|n1|format|style|must|should)\b|answer in|output in)/.test(lower) &&
    chunk.length < 1200;

  if (isDefinition) {
    return { kind: "definition", content: chunk, labels: ["definition"], confidence: 0.7 };
  }
  if (isStructure) {
    return { kind: "structure", content: chunk, labels: ["structure"], confidence: 0.7 };
  }
  return { kind: "context", content: chunk, labels: ["context"], confidence: 0.6 };
}

function buildDefinitionSuggestion(chunks: ClassifiedChunk[]) {
  const content = chunks.map((chunk) => chunk.content).join("\n\n").slice(0, 4000);
  return {
    instructions: content,
  };
}

function buildScopeSuggestion(chunks: ClassifiedChunk[]) {
  const chapters: { title: string; items: { title: string; details: string }[] }[] = [];
  let currentChapterTitle: string | null = null;

  const ensureChapter = (title: string) => {
    currentChapterTitle = title;
    let chapter = chapters.find((item) => item.title === title) || null;
    if (!chapter) {
      chapter = { title, items: [] };
      chapters.push(chapter);
    }
    return chapter;
  };

  for (const chunk of chunks) {
    const lines = chunk.content
      .split(/\n+/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    for (const line of lines) {
      if (/^(syllabus|table of contents|contents|outline|objectives?)$/i.test(line)) {
        ensureChapter("Imported structure");
        continue;
      }

      if (/^(chapter|unit|lesson|module|section)\b/i.test(line)) {
        ensureChapter(line.replace(/:\s*$/, ""));
        continue;
      }

      const itemTitle = line
        .replace(/^[-*•]\s*/, "")
        .replace(/^\d+[.)]\s*/, "")
        .replace(/^[ivx]+[.)]\s+/i, "")
        .trim();

      if (itemTitle.length < 4) continue;
      const fallbackTitle = currentChapterTitle || "Imported structure";
      const targetChapter = ensureChapter(fallbackTitle);
      if (!targetChapter.items.some((item) => item.title.toLowerCase() === itemTitle.toLowerCase())) {
        targetChapter.items.push({ title: itemTitle, details: "" });
      }
    }
  }

  return {
    chapters: chapters.filter((chapter) => chapter.items.length > 0),
    suggestedLabels: chapters.flatMap((chapter) => chapter.items.map((item) => item.title)).slice(0, 30),
  };
}

function bestScopeItemId(question: MaterialQuestion, scope: TopicScope): string | null {
  const scopeItems = scope.chapters.flatMap((chapter) => chapter.items.map((item) => ({
    id: item.id,
    title: item.title.toLowerCase(),
    chapterTitle: chapter.title.toLowerCase(),
  })));
  const haystack = [
    question.subtopic,
    ...question.subtopicTags,
    question.chapter.title,
    ...question.labels,
  ].filter(Boolean).join(" ").toLowerCase();
  return scopeItems.find((item) =>
    haystack.includes(item.title) || haystack.includes(item.chapterTitle)
  )?.id || null;
}

export async function refreshMaterialImportSummary(jobId: string) {
  const [job] = await db
    .select({ summary: materialImportJobs.summary })
    .from(materialImportJobs)
    .where(eq(materialImportJobs.id, jobId))
    .limit(1);
  if (!job) return;

  const [questions, chunks] = await Promise.all([
    db.select().from(materialQuestions).where(eq(materialQuestions.jobId, jobId)),
    db.select().from(materialTextChunks).where(eq(materialTextChunks.jobId, jobId)),
  ]);
  const activeQuestions = questions.filter((question) => question.active);
  const questionCount = activeQuestions.length;
  const needsUserReviewCount = activeQuestions.filter((question) => question.reviewStatus === "needs_user_review").length;
  const repairDebtCount = activeQuestions.filter((question) =>
    question.reviewStatus === "needs_repair" || question.reviewStatus === "unresolved"
  ).length;
  const previous = typeof job.summary === "object" && job.summary ? job.summary : {};
  const summary = {
    ...previous,
    questionCount,
    readyCount: activeQuestions.filter((question) => question.reviewStatus === "ready").length,
    autoRepairedCount: activeQuestions.filter((question) => question.reviewStatus === "auto_repaired").length,
    needsRepairCount: activeQuestions.filter((question) => question.reviewStatus === "needs_repair").length,
    needsUserReviewCount,
    unresolvedCount: activeQuestions.filter((question) => question.reviewStatus === "unresolved").length,
    manualReviewRate: questionCount > 0 ? Number((needsUserReviewCount / questionCount).toFixed(4)) : 0,
    repairDebtRate: questionCount > 0 ? Number((repairDebtCount / questionCount).toFixed(4)) : 0,
    contextCount: chunks.filter((chunk) => chunk.kind === "context" && chunk.active).length,
    structureCount: chunks.filter((chunk) => chunk.kind === "structure" && chunk.active).length,
    definitionCount: chunks.filter((chunk) => chunk.kind === "definition" && chunk.active).length,
  };

  await db
    .update(materialImportJobs)
    .set({ summary, updatedAt: new Date() })
    .where(eq(materialImportJobs.id, jobId));
}

async function persistQuestion(jobId: string, topicId: string, question: MaterialQuestion, scope: TopicScope) {
  const values = {
    topicId,
    jobId,
    content: question.question,
    options: question.options,
    correctAnswers: question.correctAnswers,
    explanations: optionExplanations(question),
    subtopicTags: question.subtopicTags,
    scopeItemId: bestScopeItemId(question, scope),
    source: question.source,
    sourceLocation: question.sourceLocation,
    confidence: question.confidence,
    reviewStatus: question.reviewStatus,
    repairFlags: question.repairFlags,
    repairActions: question.repairActions,
    rawCandidate: question.rawCandidate,
    active: true,
    contentHash: question.contentHash || hashText(question.question),
  };

  await db
    .insert(materialQuestions)
    .values(values)
    .onConflictDoNothing();
}

function scheduleImportFallback(jobId: string) {
  setTimeout(async () => {
    const [job] = await db
      .select({ status: materialImportJobs.status })
      .from(materialImportJobs)
      .where(eq(materialImportJobs.id, jobId))
      .limit(1);
    if (job?.status === "queued") {
      processMaterialImportJob(jobId).catch(() => undefined);
    }
  }, Number(process.env.MATERIAL_IMPORT_FALLBACK_MS || 5000));
}

export async function createMaterialImportJob(params: {
  topicId: string;
  userId: string;
  fileName: string;
  mimeType: string;
  content: Buffer;
}) {
  const [topic] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.id, params.topicId), eq(topics.userId, params.userId), isNull(topics.archivedAt)))
    .limit(1);
  if (!topic) throw new Error("Topic not found");

  const dir = path.join(uploadRoot(), params.userId, params.topicId);
  await mkdir(dir, { recursive: true });
  const safeName = params.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(dir, `${randomUUID()}-${safeName}`);
  await writeFile(filePath, params.content);

  const [job] = await db
    .insert(materialImportJobs)
    .values({
      topicId: params.topicId,
      userId: params.userId,
      fileName: params.fileName,
      filePath,
      mimeType: params.mimeType || "application/octet-stream",
      status: "queued",
      progress: 0,
      summary: {},
    })
    .returning();

  if (queue) {
    await queue.add("process", { jobId: job.id }, { jobId: job.id });
    scheduleImportFallback(job.id);
  } else {
    processMaterialImportJob(job.id).catch(() => undefined);
  }

  return job;
}

export async function processMaterialImportJob(jobId: string) {
  const [job] = await db.select().from(materialImportJobs).where(eq(materialImportJobs.id, jobId)).limit(1);
  if (!job) throw new Error("Import job not found");

  await db.update(materialImportJobs).set({ status: "processing", progress: 10, updatedAt: new Date() }).where(eq(materialImportJobs.id, jobId));

  try {
    const [topic] = await db.select().from(topics).where(eq(topics.id, job.topicId)).limit(1);
    if (!topic) throw new Error("Topic not found");
    const scope = normalizeScope(topic.scope);
    const extractedText = await extractTextFromFile(job.filePath, job.mimeType, job.fileName);

    await db.update(materialImportJobs).set({ progress: 40, updatedAt: new Date() }).where(eq(materialImportJobs.id, jobId));

    const extraction = await extractMaterialQuestions({
      filePath: job.fileName,
      text: extractedText,
      verifier: process.env.MATERIAL_IMPORT_AI_VERIFY === "false" ? null : buildMaterialQuestionVerifier(),
      aiSectionLimit: 0,
    });
    const paragraphs = splitParagraphs(extractedText);
    const questionLineRanges = extraction.questions.map((question) => [
      question.sourceLocation.lineStart,
      question.sourceLocation.lineEnd,
    ]);
    const helpfulChunks = paragraphs
      .filter((paragraph) =>
        !questionLineRanges.some(([start, end]) =>
          rangesOverlap(paragraph.lineStart, paragraph.lineEnd, start, end)
        )
      )
      .slice(0, 80)
      .map(({ content }) => classifyHelpfulChunk(content));

    await db.update(materialImportJobs).set({ progress: 65, updatedAt: new Date() }).where(eq(materialImportJobs.id, jobId));

    for (const question of extraction.questions) {
      await persistQuestion(jobId, job.topicId, question, scope);
    }

    for (const chunk of helpfulChunks) {
      await db.insert(materialTextChunks).values({
        topicId: job.topicId,
        jobId,
        kind: chunk.kind,
        content: chunk.content.slice(0, 8000),
        labels: chunk.labels,
        confidence: chunk.confidence,
        active: true,
      });
    }

    const structureChunks = helpfulChunks.filter((chunk) => chunk.kind === "structure");
    const definitionChunks = helpfulChunks.filter((chunk) => chunk.kind === "definition");
    if (structureChunks.length > 0) {
      await db.insert(topicUpdateSuggestions).values({
        topicId: job.topicId,
        jobId,
        type: "scope",
        payload: buildScopeSuggestion(structureChunks),
      });
    }
    if (definitionChunks.length > 0) {
      await db.insert(topicUpdateSuggestions).values({
        topicId: job.topicId,
        jobId,
        type: "definition",
        payload: buildDefinitionSuggestion(definitionChunks),
      });
    }

    const summary = {
      questionCount: extraction.questions.length,
      readyCount: extraction.questions.filter((question) => question.reviewStatus === "ready").length,
      autoRepairedCount: extraction.questions.filter((question) => question.reviewStatus === "auto_repaired").length,
      needsRepairCount: extraction.questions.filter((question) => question.reviewStatus === "needs_repair").length,
      needsUserReviewCount: extraction.questions.filter((question) => question.reviewStatus === "needs_user_review").length,
      unresolvedCount: extraction.questions.filter((question) => question.reviewStatus === "unresolved").length,
      manualReviewRate: extraction.report.manualReviewRate,
      repairDebtRate: extraction.report.repairDebtRate,
      contextCount: helpfulChunks.filter((chunk) => chunk.kind === "context").length,
      structureCount: structureChunks.length,
      definitionCount: definitionChunks.length,
      duplicateCount: extraction.report.duplicateQuestions,
      aiVerifiedCount: extraction.report.ai.verifiedQuestions,
      aiFailedVerificationCount: extraction.report.ai.failedVerifications,
      webValidatedCount: 0,
      unmatchedAnswerCount: extraction.report.unmatchedAnswerQuestions,
    };

    const materials = normalizeMaterials(topic.materials);
    const contextText = helpfulChunks
      .filter((chunk) => chunk.kind === "context")
      .map((chunk) => chunk.content)
      .join("\n\n")
      .slice(0, 3500);
    if (contextText) {
      const updatedMaterials: TopicMaterials = {
        ...materials,
        notes: [materials.notes, contextText].filter(Boolean).join("\n\n").slice(0, 4000),
      };
      await db.update(topics).set({ materials: updatedMaterials }).where(eq(topics.id, job.topicId));
    }

    await db.update(materialImportJobs).set({
      status: "completed",
      progress: 100,
      summary,
      updatedAt: new Date(),
      completedAt: new Date(),
    }).where(eq(materialImportJobs.id, jobId));
  } catch (error) {
    await db.update(materialImportJobs).set({
      status: "failed",
      error: error instanceof Error ? error.message : "Import failed",
      updatedAt: new Date(),
      completedAt: new Date(),
    }).where(eq(materialImportJobs.id, jobId));
    throw error;
  }
}

export function startMaterialImportWorker() {
  const url = redisUrl();
  if (!url || queue) return;
  const connection = new IORedis(url, { maxRetriesPerRequest: null });
  queue = new Queue<ImportJobData>(QUEUE_NAME, { connection });
  if (process.env.MATERIAL_IMPORT_WORKER_ENABLED !== "false") {
    worker = new Worker<ImportJobData>(
      QUEUE_NAME,
      async (job: Job<ImportJobData>) => {
        await processMaterialImportJob(job.data.jobId);
      },
      { connection }
    );
  }
}

export async function processPastedContent(params: {
  topicId: string;
  userId: string;
  text: string;
  files?: { fileName: string; mimeType: string; content: Buffer }[];
}): Promise<{ jobId: string; questionCount: number; error?: string }> {
  const [topic] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.id, params.topicId), eq(topics.userId, params.userId), isNull(topics.archivedAt)))
    .limit(1);
  if (!topic) throw new Error("Topic not found");

  const [job] = await db
    .insert(materialImportJobs)
    .values({
      topicId: params.topicId,
      userId: params.userId,
      fileName: "paste-import",
      filePath: "",
      mimeType: "text/plain",
      status: "processing",
      progress: 10,
      summary: {},
    })
    .returning();

  try {
    const extractedTexts: string[] = [];

    if (params.files && params.files.length > 0) {
      const dir = path.join(uploadRoot(), params.userId, params.topicId);
      await mkdir(dir, { recursive: true });

      for (const file of params.files) {
        try {
          const safeName = file.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
          const filePath = path.join(dir, `${randomUUID()}-${safeName}`);
          await writeFile(filePath, file.content);
          const text = await extractTextFromFile(filePath, file.mimeType, file.fileName);
          if (text.trim()) extractedTexts.push(text);
        } catch {
          /* skip failed file */
        }
      }
    }

    if (params.text.trim()) extractedTexts.unshift(params.text);
    const combinedText = extractedTexts.join("\n\n");

    if (!combinedText.trim()) {
      await db.update(materialImportJobs).set({
        status: "failed",
        error: "No text content provided",
        updatedAt: new Date(),
        completedAt: new Date(),
      }).where(eq(materialImportJobs.id, job.id));
      return { jobId: job.id, questionCount: 0, error: "No text content provided" };
    }

    await db.update(materialImportJobs).set({ progress: 40, updatedAt: new Date() }).where(eq(materialImportJobs.id, job.id));

    const scope = normalizeScope(topic.scope);
    const extraction = await extractMaterialQuestions({
      filePath: "paste-import",
      text: combinedText,
      verifier: process.env.MATERIAL_IMPORT_AI_VERIFY === "false" ? null : buildMaterialQuestionVerifier(),
      aiSectionLimit: 0,
    });

    const paragraphs = splitParagraphs(combinedText);
    const questionLineRanges = extraction.questions.map((question) => [
      question.sourceLocation.lineStart,
      question.sourceLocation.lineEnd,
    ]);
    const helpfulChunks = paragraphs
      .filter((paragraph) =>
        !questionLineRanges.some(([start, end]) =>
          rangesOverlap(paragraph.lineStart, paragraph.lineEnd, start, end)
        )
      )
      .slice(0, 80)
      .map(({ content }) => classifyHelpfulChunk(content));

    await db.update(materialImportJobs).set({ progress: 65, updatedAt: new Date() }).where(eq(materialImportJobs.id, job.id));

    for (const question of extraction.questions) {
      await persistQuestion(job.id, params.topicId, question, scope);
    }

    for (const chunk of helpfulChunks) {
      await db.insert(materialTextChunks).values({
        topicId: params.topicId,
        jobId: job.id,
        kind: chunk.kind,
        content: chunk.content.slice(0, 8000),
        labels: chunk.labels,
        confidence: chunk.confidence,
        active: true,
      });
    }

    const structureChunks = helpfulChunks.filter((chunk) => chunk.kind === "structure");
    const definitionChunks = helpfulChunks.filter((chunk) => chunk.kind === "definition");
    if (structureChunks.length > 0) {
      await db.insert(topicUpdateSuggestions).values({
        topicId: params.topicId,
        jobId: job.id,
        type: "scope",
        payload: buildScopeSuggestion(structureChunks),
      });
    }
    if (definitionChunks.length > 0) {
      await db.insert(topicUpdateSuggestions).values({
        topicId: params.topicId,
        jobId: job.id,
        type: "definition",
        payload: buildDefinitionSuggestion(definitionChunks),
      });
    }

    const summary = {
      questionCount: extraction.questions.length,
      readyCount: extraction.questions.filter((question) => question.reviewStatus === "ready").length,
      autoRepairedCount: extraction.questions.filter((question) => question.reviewStatus === "auto_repaired").length,
      needsRepairCount: extraction.questions.filter((question) => question.reviewStatus === "needs_repair").length,
      needsUserReviewCount: extraction.questions.filter((question) => question.reviewStatus === "needs_user_review").length,
      unresolvedCount: extraction.questions.filter((question) => question.reviewStatus === "unresolved").length,
      manualReviewRate: extraction.report.manualReviewRate,
      repairDebtRate: extraction.report.repairDebtRate,
      contextCount: helpfulChunks.filter((chunk) => chunk.kind === "context").length,
      structureCount: structureChunks.length,
      definitionCount: definitionChunks.length,
    };

    const materials = normalizeMaterials(topic.materials);
    const contextText = helpfulChunks
      .filter((chunk) => chunk.kind === "context")
      .map((chunk) => chunk.content)
      .join("\n\n")
      .slice(0, 3500);
    if (contextText) {
      const updatedMaterials: TopicMaterials = {
        ...materials,
        notes: [materials.notes, contextText].filter(Boolean).join("\n\n").slice(0, 4000),
      };
      await db.update(topics).set({ materials: updatedMaterials }).where(eq(topics.id, params.topicId));
    }

    await db.update(materialImportJobs).set({
      status: "completed",
      progress: 100,
      summary,
      updatedAt: new Date(),
      completedAt: new Date(),
    }).where(eq(materialImportJobs.id, job.id));

    return { jobId: job.id, questionCount: extraction.questions.length };
  } catch (error) {
    await db.update(materialImportJobs).set({
      status: "failed",
      error: error instanceof Error ? error.message : "Import failed",
      updatedAt: new Date(),
      completedAt: new Date(),
    }).where(eq(materialImportJobs.id, job.id));
    return { jobId: job.id, questionCount: 0, error: error instanceof Error ? error.message : "Import failed" };
  }
}

export async function closeMaterialImportWorker() {
  await worker?.close();
  await queue?.close();
  worker = null;
  queue = null;
}
