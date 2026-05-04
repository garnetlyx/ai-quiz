import { createHash } from "crypto";
import { db } from "../db/index.js";
import { questions, quizSessions, topics } from "../db/schema.js";
import { eq, and, desc, count } from "drizzle-orm";
import { generateQuestions } from "./ai.js";
import { factCheckQuestion } from "./search.js";

function computeContentHash(text: string): string {
  const normalized = text.toLowerCase().trim().replace(/[^\w\s]/g, "");
  return createHash("sha256").update(normalized).digest("hex");
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
    .where(and(eq(topics.id, topicId), eq(topics.userId, userId)))
    .limit(1);

  if (!topic) throw new Error("Topic not found");
  if (!topic.examFormat) throw new Error("Topic format not confirmed");

  const existingHashes = await db
    .select({ contentHash: questions.contentHash })
    .from(questions)
    .where(eq(questions.topicId, topicId));

  const generated = await generateQuestions({
    topic: topic.description,
    format: topic.examFormat as { choicesCount: number; isMultiSelect: boolean },
    count: questionCount,
    existingHashes: existingHashes.map((h) => h.contentHash),
    subtopicFilter: options?.subtopicFilter,
  });

  for (const q of generated) {
    await factCheckQuestion(q.content);
  }

  const [session] = await db
    .insert(quizSessions)
    .values({
      topicId,
      questionCount: generated.length,
      timerEnabled: options?.timerEnabled ?? false,
      timerDurationSeconds: options?.timerDurationSeconds ?? null,
      mode: options?.mode ?? "normal",
      subtopicFilter: options?.subtopicFilter ?? null,
    })
    .returning();

  const questionRows = await db
    .insert(questions)
    .values(
      generated.map((q) => ({
        sessionId: session.id,
        topicId,
        content: q.content,
        options: q.options,
        correctAnswers: q.correctAnswers,
        explanations: q.explanations,
        subtopicTags: q.subtopicTags,
        contentHash: computeContentHash(q.content),
      }))
    )
    .returning();

  return {
    session: {
      id: session.id,
      topicId: session.topicId,
      questionCount: session.questionCount,
      timerEnabled: session.timerEnabled,
      timerDurationSeconds: session.timerDurationSeconds,
      mode: session.mode,
      createdAt: session.createdAt,
    },
    questions: questionRows.map((q) => ({
      id: q.id,
      content: q.content,
      options: q.options,
      subtopicTags: q.subtopicTags,
      isFlagged: q.isFlagged,
    })),
  };
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

  const questionRows = await db
    .select()
    .from(questions)
    .where(eq(questions.sessionId, sessionId));

  let correctCount = 0;

  for (const question of questionRows) {
    const userAnswer = answers[question.id] || [];
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
    .where(eq(questions.sessionId, sessionId));

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

  const questionRows = await db
    .select()
    .from(questions)
    .where(eq(questions.sessionId, sessionId));

  return {
    session: session.quiz_sessions,
    questions: questionRows,
  };
}

export async function getMissedQuestions(topicId: string, userId: string) {
  const [topic] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.id, topicId), eq(topics.userId, userId)))
    .limit(1);

  if (!topic) throw new Error("Topic not found");

  return db
    .select()
    .from(questions)
    .where(
      and(
        eq(questions.topicId, topicId),
        eq(questions.isCorrect, false),
        eq(questions.isFlagged, false)
      )
    );
}

export async function getWeakSubtopics(topicId: string, userId: string) {
  const [topic] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.id, topicId), eq(topics.userId, userId)))
    .limit(1);

  if (!topic) throw new Error("Topic not found");

  const missed = await db
    .select({
      subtopicTags: questions.subtopicTags,
      topicId: questions.topicId,
    })
    .from(questions)
    .where(
      and(
        eq(questions.topicId, topicId),
        eq(questions.isCorrect, false),
        eq(questions.isFlagged, false)
      )
    );

  const allQuestions = await db
    .select({ subtopicTags: questions.subtopicTags })
    .from(questions)
    .where(eq(questions.topicId, topicId));

  const subtopicStats = new Map<
    string,
    { missCount: number; totalCount: number }
  >();

  for (const q of missed) {
    for (const tag of q.subtopicTags || []) {
      const stat = subtopicStats.get(tag) || { missCount: 0, totalCount: 0 };
      stat.missCount++;
      subtopicStats.set(tag, stat);
    }
  }

  for (const q of allQuestions) {
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

  await db
    .update(questions)
    .set({ isFlagged: true, flagReason: reason })
    .where(and(eq(questions.id, questionId), eq(questions.sessionId, sessionId)));
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
    .where(and(eq(topics.id, topicId), eq(topics.userId, userId)))
    .limit(1);

  if (!topic) throw new Error("Topic not found");

  const offset = (page - 1) * limit;

  const sessions = await db
    .select()
    .from(quizSessions)
    .where(eq(quizSessions.topicId, topicId))
    .orderBy(desc(quizSessions.completedAt))
    .limit(limit)
    .offset(offset);

  const [totalResult] = await db
    .select({ count: count() })
    .from(quizSessions)
    .where(eq(quizSessions.topicId, topicId));

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
