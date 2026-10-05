import { createHash } from "crypto";
import { db } from "../db/index.js";
import { materialQuestions, materialTextChunks, questions, quizSessions, topics } from "../db/schema.js";
import { eq, and, asc, desc, count, isNull, isNotNull, inArray } from "drizzle-orm";
import { generateQuestions, getClient, getModel, parseJsonObject, getMessageContent, validateAiResponse } from "./ai.js";
import { searchWeb } from "./search.js";
import { buildFlagVerifyMessages } from "../prompts/flag-verify.js";
import {
  activeScopeItems,
  buildScopeContext,
  defaultScope,
  normalizeMaterials,
  normalizeScope,
  scopeItemExists,
} from "./scope.js";
import type { ExamFormat, FlagVerificationResult, TopicScopeItem, TopicScope } from "@ai-quiz/shared";
import { z } from "zod";

export function computeContentHash(text: string): string {
  const normalized = text.toLowerCase().trim().replace(/[^\w\s]/g, "");
  return createHash("sha256").update(normalized).digest("hex");
}

const flagVerifyResultSchema = z.object({
  verdict: z.enum(["upheld", "corrected"]),
  reasoning: z.string(),
  correctedAnswers: z.array(z.number().int()).optional(),
  correctedExplanations: z.array(z.object({
    optionId: z.string(),
    isCorrect: z.boolean(),
    explanation: z.string(),
  })).optional(),
  sources: z.array(z.object({
    url: z.string(),
    title: z.string(),
    snippet: z.string(),
  })).default([]),
});

export async function verifyFlaggedQuestion(questionId: string): Promise<void> {
  const [question] = await db
    .select()
    .from(questions)
    .where(eq(questions.id, questionId))
    .limit(1);
  if (!question || !question.isFlagged || question.flagStatus !== "pending_review") return;

  try {
    const searchResults = await searchWeb(question.content, 5);
    const messages = buildFlagVerifyMessages({
      questionContent: question.content,
      options: question.options as { id: string; text: string }[],
      correctAnswers: question.correctAnswers as number[],
      explanations: question.explanations as { optionId: string; isCorrect: boolean; explanation: string }[],
      flagReason: question.flagReason || "",
      flagCategory: question.flagCategory || "wrong_answer",
      searchResults,
    });

    const response = await getClient().chat.completions.create({
      model: getModel(),
      messages,
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const parsed = parseJsonObject(getMessageContent(response));
    const verified = validateAiResponse(flagVerifyResultSchema, parsed, "flag verification");

    const verificationResult: FlagVerificationResult = {
      verdict: verified.verdict,
      reasoning: verified.reasoning,
      sources: verified.sources,
      ...(verified.verdict === "corrected" && verified.correctedAnswers
        ? {
            correctedAnswers: verified.correctedAnswers,
            correctedExplanations: verified.correctedExplanations,
          }
        : {}),
    };

    const updates: Record<string, unknown> = {
      flagStatus: verified.verdict,
      flagVerificationResult: verificationResult,
      flagVerifiedAt: new Date(),
    };

    if (verified.verdict === "corrected" && verified.correctedAnswers && verified.correctedAnswers.length > 0) {
      updates.correctAnswers = verified.correctedAnswers;
      if (verified.correctedExplanations) {
        updates.explanations = verified.correctedExplanations;
      }

      // Cascade to material_questions source
      if (question.materialQuestionId) {
        const materialUpdates: Record<string, unknown> = {
          correctAnswers: verified.correctedAnswers,
          updatedAt: new Date(),
        };
        if (verified.correctedExplanations) {
          materialUpdates.explanations = verified.correctedExplanations;
        }
        await db
          .update(materialQuestions)
          .set(materialUpdates)
          .where(eq(materialQuestions.id, question.materialQuestionId));
      }
    }

    await db
      .update(questions)
      .set(updates)
      .where(eq(questions.id, questionId));
  } catch {
    await db
      .update(questions)
      .set({ flagStatus: "verification_failed", flagVerifiedAt: new Date() })
      .where(eq(questions.id, questionId));
  }
}

function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function stratifiedSample<T extends { scopeItemId: string | null; subtopicTags: string[] | null }>(
  pool: T[],
  count: number,
  scopePlan: { id: string; count: number }[]
): T[] {
  if (pool.length <= count) return shuffle(pool);

  const scopeCounts = new Map(scopePlan.map((item) => [item.id, item.count]));
  const grouped = new Map<string, T[]>();
  const unassigned: T[] = [];

  for (const item of pool) {
    if (item.scopeItemId && scopeCounts.has(item.scopeItemId)) {
      const list = grouped.get(item.scopeItemId) || [];
      list.push(item);
      grouped.set(item.scopeItemId, list);
    } else {
      const matchedTag = (item.subtopicTags || []).find((tag) => scopeCounts.has(tag));
      if (matchedTag) {
        const list = grouped.get(matchedTag) || [];
        list.push(item);
        grouped.set(matchedTag, list);
      } else {
        unassigned.push(item);
      }
    }
  }

  for (const [key] of grouped) {
    grouped.set(key, shuffle(grouped.get(key)!));
  }
  const shuffledUnassigned = shuffle(unassigned);

  const selected: T[] = [];
  const quota = new Map(scopePlan.map((item) => [item.id, item.count]));
  const scopeOrder = shuffle(scopePlan.map((item) => item.id));

  for (const scopeId of scopeOrder) {
    const items = grouped.get(scopeId) || [];
    const take = Math.min(quota.get(scopeId) || 0, items.length);
    selected.push(...items.slice(0, take));
  }

  // Quotas can under-fill (a planned scope item may have few or no bank
  // questions). Top up from every unselected question, unassigned first, so the
  // AI is only asked for questions the bank genuinely cannot supply.
  if (selected.length < count) {
    const chosen = new Set(selected);
    const leftoverScoped = shuffle([...grouped.values()].flat().filter((item) => !chosen.has(item)));
    const remaining = [...shuffledUnassigned, ...leftoverScoped];
    selected.push(...remaining.slice(0, count - selected.length));
  }

  return shuffle(selected.slice(0, count));
}

export function buildScopePlan(
  items: TopicScopeItem[],
  questionCount: number,
  subtopicFilter?: string[]
) {
  const normalizedFilter = new Set(
    (subtopicFilter || []).map((item) => item.toLowerCase())
  );
  const eligible = normalizedFilter.size > 0
    ? items.filter((item) =>
        normalizedFilter.has(item.id.toLowerCase()) ||
        normalizedFilter.has(item.title.toLowerCase())
      )
    : items;
  const pool = shuffle(eligible.length > 0 ? eligible : items);
  const counts = new Map<string, { id: string; title: string; count: number }>();

  for (let i = 0; i < questionCount; i++) {
    const item = pool[i % pool.length];
    const current = counts.get(item.id) || { id: item.id, title: item.title, count: 0 };
    current.count++;
    counts.set(item.id, current);
  }

  return Array.from(counts.values());
}

function matchesSubtopicFilter(
  question: { scopeItemId: string | null; subtopicTags: string[] | null },
  subtopicFilter?: string[]
) {
  if (!subtopicFilter || subtopicFilter.length === 0) return true;
  const normalized = new Set(subtopicFilter.map((item) => item.toLowerCase()));
  return (
    (question.scopeItemId && normalized.has(question.scopeItemId.toLowerCase())) ||
    (question.subtopicTags || []).some((tag) => normalized.has(tag.toLowerCase()))
  );
}

async function getActiveMaterialContext(topicId: string) {
  const chunks = await db
    .select()
    .from(materialTextChunks)
    .where(
      and(
        eq(materialTextChunks.topicId, topicId),
        eq(materialTextChunks.active, true),
        eq(materialTextChunks.kind, "context")
      )
    );
  return chunks
    .map((chunk) => `[${chunk.kind}] ${chunk.content}`)
    .join("\n\n")
    .slice(0, 5000);
}

export async function generateQuizForTopic(
  topicId: string,
  questionCount: number,
  userId: string,
  options?: {
    timerEnabled?: boolean;
    timerDurationSeconds?: number;
    mode?: "normal" | "retry" | "subtopic";
    subtopicFilter?: string[];
  }
) {
  const [topic] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.id, topicId), eq(topics.userId, userId), isNull(topics.archivedAt)))
    .limit(1);

  if (!topic) throw new Error("Topic not found");
  if (!topic.examFormat) throw new Error("Topic format not confirmed");
  const format = topic.examFormat as ExamFormat;
  let scope = normalizeScope(topic.scope);
  const materials = normalizeMaterials(topic.materials);
  let activeItems = activeScopeItems(scope);
  if (activeItems.length === 0) {
    scope = defaultScope(topic.description || topic.title);
    activeItems = activeScopeItems(scope);
  }
  const scopePlan = buildScopePlan(
    activeItems,
    questionCount,
    options?.subtopicFilter
  );

  const existingHashes = await db
    .select({ contentHash: questions.contentHash })
    .from(questions)
    .where(eq(questions.topicId, topicId));

  const attemptedMaterialRows = await db
    .select({ materialQuestionId: questions.materialQuestionId })
    .from(questions)
    .where(eq(questions.topicId, topicId));
  const attemptedMaterialIds = new Set(
    attemptedMaterialRows
      .map((row) => row.materialQuestionId)
      .filter((value): value is string => Boolean(value))
  );
  const materialBank = await db
    .select()
    .from(materialQuestions)
    .where(
      and(
        eq(materialQuestions.topicId, topicId),
        inArray(materialQuestions.reviewStatus, ["ready", "auto_repaired"]),
        eq(materialQuestions.active, true)
      )
    );
  const unattempted = materialBank
    .filter((question) => !attemptedMaterialIds.has(question.id))
    .filter((question) => matchesSubtopicFilter(question, options?.subtopicFilter));
  const selectedMaterial = stratifiedSample(unattempted, questionCount, scopePlan);
  const aiCount = Math.max(0, questionCount - selectedMaterial.length);

  const [session] = await db
    .insert(quizSessions)
    .values({
      topicId,
      questionCount: selectedMaterial.length + aiCount,
      timerEnabled: options?.timerEnabled ?? false,
      timerDurationSeconds: options?.timerDurationSeconds ?? null,
      mode: options?.mode ?? "normal",
      subtopicFilter: options?.subtopicFilter ?? null,
    })
    .returning();

  const materialRows = selectedMaterial.length > 0 ? await db
    .insert(questions)
    .values(
      selectedMaterial.map((q) => ({
        sessionId: session.id,
        topicId,
        content: q.content,
        options: q.options,
        correctAnswers: q.correctAnswers,
        explanations: q.explanations,
        subtopicTags: q.subtopicTags,
        scopeItemId: q.scopeItemId,
        materialQuestionId: q.id,
        contentHash: q.contentHash,
      }))
    )
    .returning() : [];

  const result = {
    session: {
      id: session.id,
      topicId: session.topicId,
      questionCount: session.questionCount,
      timerEnabled: session.timerEnabled,
      timerDurationSeconds: session.timerDurationSeconds,
      mode: session.mode,
      createdAt: session.createdAt,
    },
    questions: materialRows.map((q) => ({
      id: q.id,
      content: q.content,
      options: q.options,
      subtopicTags: q.subtopicTags,
      scopeItemId: q.scopeItemId,
      isMultiSelect: format.isMultiSelect,
      isFlagged: q.isFlagged,
    })),
    pendingCount: aiCount,
    isMultiSelect: format.isMultiSelect,
  };

async function retryGenerateAi(
  sessionId: string,
  topicId: string,
  topicDescription: string,
  format: ExamFormat,
  aiCount: number,
  existingHashes: { contentHash: string }[],
  options: {
    subtopicFilter?: string[];
  } | undefined,
  materials: { instructions?: string } | undefined,
  scope: TopicScope | undefined,
  scopePlan: { id: string; title: string; count: number }[] | undefined,
  retriesLeft: number,
) {
  try {
    await generateAiQuestions(sessionId, topicId, topicDescription, format, aiCount, existingHashes, options, materials, scope, scopePlan);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[generateAiQuestions] Failed for session ${sessionId} (${retriesLeft} retries left): ${msg}`);
    if (retriesLeft > 0) {
      await new Promise((r) => setTimeout(r, 5000));
      return retryGenerateAi(sessionId, topicId, topicDescription, format, aiCount, existingHashes, options, materials, scope, scopePlan, retriesLeft - 1);
    }
    await settleSessionAfterGenerationFailure(sessionId).catch(() => undefined);
  }
}


  if (aiCount > 0) {
    setTimeout(() => retryGenerateAi(
      session.id, topicId, topic.description, format, aiCount, existingHashes, options, materials, scope, scopePlan, 3,
    ), 0);
  }

  return result;
}

// When AI generation gives up, the session is complete at the size it really
// has; clients compare that with the size they asked for and tell the user.
export async function settleSessionAfterGenerationFailure(sessionId: string) {
  const [present] = await db
    .select({ count: count() })
    .from(questions)
    .where(eq(questions.sessionId, sessionId));
  await db
    .update(quizSessions)
    .set({ questionCount: present?.count ?? 0 })
    .where(eq(quizSessions.id, sessionId));
}

async function generateAiQuestions(
  sessionId: string,
  topicId: string,
  topicDescription: string,
  format: ExamFormat,
  aiCount: number,
  existingHashes: { contentHash: string }[],
  options?: {
    subtopicFilter?: string[];
  },
  materials?: { instructions?: string },
  scope?: TopicScope,
  scopePlan?: { id: string; title: string; count: number }[],
) {
  const materialContext = await getActiveMaterialContext(topicId);
  const normalizedScope = scope ? normalizeScope(scope) : undefined;
  const normalizedMaterials = materials ? normalizeMaterials(materials) : undefined;

  const generated = await generateQuestions({
    topic: topicDescription,
    format,
    count: aiCount,
    existingHashes: existingHashes.map((h) => h.contentHash),
    subtopicFilter: options?.subtopicFilter,
    instructions: normalizedMaterials?.instructions,
    scopeContext: normalizedScope && normalizedMaterials
      ? [buildScopeContext(normalizedScope, normalizedMaterials), materialContext].filter(Boolean).join("\n\nImported material context:\n")
      : materialContext || undefined,
    scopePlan: scopePlan || undefined,
  });

  for (const q of generated) {
    await db.insert(questions).values({
      sessionId,
      topicId,
      content: q.content,
      options: q.options,
      correctAnswers: q.correctAnswers,
      explanations: q.explanations.map((e) => ({
        optionId: e.optionId,
        isCorrect: e.isCorrect,
        explanation: e.explanation,
      })),
      subtopicTags: q.subtopicTags,
      scopeItemId: q.scopeItemId && normalizedScope && scopeItemExists(normalizedScope, q.scopeItemId)
        ? q.scopeItemId
        : scopePlan?.[0]?.id ?? null,
      materialQuestionId: null,
      contentHash: computeContentHash(q.content),
    });
  }
}

export async function submitQuizAnswers(
  sessionId: string,
  answers: Record<string, number[]>,
  userId: string
) {
  const [session] = await db
    .select()
    .from(quizSessions)
    .innerJoin(topics, eq(quizSessions.topicId, topics.id))
    .where(eq(quizSessions.id, sessionId))
    .limit(1);

  if (!session) throw new Error("Session not found");
  if (session.topics.userId !== userId) throw new Error("Forbidden");
  if (session.topics.archivedAt) throw new Error("Session not found");

  const questionRows = await db
    .select()
    .from(questions)
    .where(eq(questions.sessionId, sessionId))
    .orderBy(asc(questions.position));
  const format = session.topics.examFormat as ExamFormat | null;

  let correctCount = 0;

  for (const question of questionRows) {
    const submittedAnswer = answers[question.id] || [];
    if (format && !format.isMultiSelect && submittedAnswer.length > 1) {
      throw new Error("Single-select questions accept one answer");
    }
    const userAnswer = format && !format.isMultiSelect
      ? submittedAnswer.slice(0, 1)
      : submittedAnswer;
    const isCorrect =
      userAnswer.length === question.correctAnswers.length &&
      userAnswer.every((a) => question.correctAnswers.includes(a)) &&
      question.correctAnswers.every((a) => userAnswer.includes(a));

    if (isCorrect) correctCount++;

    await db
      .update(questions)
      .set({ userAnswers: userAnswer, isCorrect })
      .where(eq(questions.id, question.id));
  }

  const score = Math.round((correctCount / questionRows.length) * 100);

  await db
    .update(quizSessions)
    .set({
      score,
      completedAt: new Date(),
    })
    .where(eq(quizSessions.id, sessionId));

  const updatedQuestions = await db
    .select()
    .from(questions)
    .where(eq(questions.sessionId, sessionId))
    .orderBy(asc(questions.position));

  return {
    session: {
      id: sessionId,
      score,
      questionCount: questionRows.length,
      completedAt: new Date().toISOString(),
    },
    questions: updatedQuestions,
    score,
    totalQuestions: questionRows.length,
  };
}

export async function getQuizResults(sessionId: string, userId: string) {
  const [session] = await db
    .select()
    .from(quizSessions)
    .innerJoin(topics, eq(quizSessions.topicId, topics.id))
    .where(eq(quizSessions.id, sessionId))
    .limit(1);

  if (!session) throw new Error("Session not found");
  if (session.topics.userId !== userId) throw new Error("Forbidden");
  if (session.topics.archivedAt) throw new Error("Session not found");

  const questionRows = await db
    .select()
    .from(questions)
    .where(eq(questions.sessionId, sessionId))
    .orderBy(asc(questions.position));

  const orphanedFlags = questionRows.filter(
    (q) => q.isFlagged && q.flagStatus === "pending_review" && !q.flagVerifiedAt
  );
  for (const orphan of orphanedFlags) {
    setTimeout(() => verifyFlaggedQuestion(orphan.id).catch(() => undefined), 0);
  }

  return {
    session: session.quiz_sessions,
    questions: questionRows,
  };
}

export async function getMissedQuestions(topicId: string, userId: string) {
  const [topic] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.id, topicId), eq(topics.userId, userId), isNull(topics.archivedAt)))
    .limit(1);

  if (!topic) throw new Error("Topic not found");
  const activeItemIds = new Set(activeScopeItems(normalizeScope(topic.scope)).map((item) => item.id));

  const missed = await db
    .select()
    .from(questions)
    .where(
      and(
        eq(questions.topicId, topicId),
        eq(questions.isCorrect, false),
        eq(questions.isFlagged, false)
      )
    );
  return missed.filter((question) =>
    !question.scopeItemId || activeItemIds.has(question.scopeItemId)
  );
}

export async function getWeakSubtopics(topicId: string, userId: string) {
  const [topic] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.id, topicId), eq(topics.userId, userId), isNull(topics.archivedAt)))
    .limit(1);

  if (!topic) throw new Error("Topic not found");
  const activeItemIds = new Set(activeScopeItems(normalizeScope(topic.scope)).map((item) => item.id));

  const missed = await db
    .select({
      subtopicTags: questions.subtopicTags,
      topicId: questions.topicId,
      scopeItemId: questions.scopeItemId,
    })
    .from(questions)
    .where(
      and(
        eq(questions.topicId, topicId),
        eq(questions.isCorrect, false),
        eq(questions.isFlagged, false)
      )
    );
  const activeMissed = missed.filter((question) =>
    !question.scopeItemId || activeItemIds.has(question.scopeItemId)
  );

  const allQuestions = await db
    .select({ subtopicTags: questions.subtopicTags, scopeItemId: questions.scopeItemId })
    .from(questions)
    .where(eq(questions.topicId, topicId));
  const activeQuestions = allQuestions.filter((question) =>
    !question.scopeItemId || activeItemIds.has(question.scopeItemId)
  );

  const subtopicStats = new Map<
    string,
    { missCount: number; totalCount: number }
  >();

  for (const q of activeMissed) {
    for (const tag of q.subtopicTags || []) {
      const stat = subtopicStats.get(tag) || { missCount: 0, totalCount: 0 };
      stat.missCount++;
      subtopicStats.set(tag, stat);
    }
  }

  for (const q of activeQuestions) {
    for (const tag of q.subtopicTags || []) {
      const stat = subtopicStats.get(tag) || { missCount: 0, totalCount: 0 };
      stat.totalCount++;
      subtopicStats.set(tag, stat);
    }
  }

  return Array.from(subtopicStats.entries())
    .map(([subtopic, stats]) => ({
      subtopic,
      missCount: stats.missCount,
      totalQuestions: stats.totalCount,
      missRate:
        stats.totalCount > 0
          ? Math.round((stats.missCount / stats.totalCount) * 100)
          : 0,
    }))
    .sort((a, b) => b.missRate - a.missRate);
}

export async function flagQuestion(
  sessionId: string,
  questionId: string,
  reason: string,
  userId: string,
  category?: string
) {
  const [session] = await db
    .select()
    .from(quizSessions)
    .innerJoin(topics, eq(quizSessions.topicId, topics.id))
    .where(eq(quizSessions.id, sessionId))
    .limit(1);

  if (!session) throw new Error("Session not found");
  if (session.topics.userId !== userId) throw new Error("Forbidden");
  if (session.topics.archivedAt) throw new Error("Session not found");

  await db
    .update(questions)
    .set({
      isFlagged: true,
      flagReason: reason,
      flagCategory: category || null,
      flagStatus: "pending_review",
    })
    .where(and(eq(questions.id, questionId), eq(questions.sessionId, sessionId)));

  setTimeout(() => verifyFlaggedQuestion(questionId).catch(() => undefined), 0);
}

export async function getQuizHistory(
  topicId: string,
  userId: string,
  page = 1,
  limit = 20
) {
  const [topic] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.id, topicId), eq(topics.userId, userId), isNull(topics.archivedAt)))
    .limit(1);

  if (!topic) throw new Error("Topic not found");

  const offset = (page - 1) * limit;
  // Abandoned / still-generating sessions are noise in history: only quizzes
  // the user actually finished belong here.
  const completedFilter = and(
    eq(quizSessions.topicId, topicId),
    isNotNull(quizSessions.completedAt)
  );

  const sessions = await db
    .select()
    .from(quizSessions)
    .where(completedFilter)
    .orderBy(desc(quizSessions.completedAt))
    .limit(limit)
    .offset(offset);

  const [totalResult] = await db
    .select({ count: count() })
    .from(quizSessions)
    .where(completedFilter);

  return {
    data: sessions.map((s) => ({
      sessionId: s.id,
      score: s.score,
      questionCount: s.questionCount,
      completedAt: s.completedAt,
      mode: s.mode,
    })),
    total: totalResult?.count ?? 0,
    page,
    limit,
  };
}
