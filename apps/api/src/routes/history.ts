import { FastifyInstance } from "fastify";
import {
  getMissedQuestions,
  getWeakSubtopics,
  getQuizHistory,
} from "../services/quiz.js";
import { db } from "../db/index.js";
import { questions, quizSessions, topics } from "../db/schema.js";
import { and, eq, isNull } from "drizzle-orm";
import type { ExamFormat } from "@ai-quiz/shared";

export async function historyRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (request) => {
    await app.authenticate(request);
  });

  app.get("/api/topics/:topicId/missed", async (request, reply) => {
    const { topicId } = request.params as { topicId: string };
    const userId = (request.user as { userId: string }).userId;

    try {
      const missed = await getMissedQuestions(topicId, userId);
      return reply.send(missed);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to get missed questions";
      return reply.status(404).send({ message });
    }
  });

  app.get("/api/topics/:topicId/weak-subtopics", async (request, reply) => {
    const { topicId } = request.params as { topicId: string };
    const userId = (request.user as { userId: string }).userId;

    try {
      const subtopics = await getWeakSubtopics(topicId, userId);
      return reply.send(subtopics);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to get weak subtopics";
      return reply.status(404).send({ message });
    }
  });

  app.get("/api/topics/:topicId/history", async (request, reply) => {
    const { topicId } = request.params as { topicId: string };
    const userId = (request.user as { userId: string }).userId;
    const page = parseInt((request.query as { page?: string }).page || "1", 10);
    const limit = parseInt(
      (request.query as { limit?: string }).limit || "20",
      10
    );

    try {
      const history = await getQuizHistory(topicId, userId, page, limit);
      return reply.send(history);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to get history";
      return reply.status(404).send({ message });
    }
  });

  app.post(
    "/api/topics/:topicId/quiz/retry",
    async (request, reply) => {
      const { topicId } = request.params as { topicId: string };
      const userId = (request.user as { userId: string }).userId;
      const [topic] = await db
        .select()
        .from(topics)
        .where(and(eq(topics.id, topicId), eq(topics.userId, userId), isNull(topics.archivedAt)))
        .limit(1);

      if (!topic) return reply.status(404).send({ message: "Topic not found" });
      const format = topic.examFormat as ExamFormat | null;

      const missed = await getMissedQuestions(topicId, userId);
      if (missed.length === 0) {
        return reply.status(400).send({ message: "No missed questions to retry" });
      }

      const [session] = await db
        .insert(quizSessions)
        .values({
          topicId,
          questionCount: missed.length,
          timerEnabled: false,
          mode: "retry",
        })
        .returning();

      const questionRows = await db
        .insert(questions)
        .values(
          missed.map((q) => ({
            sessionId: session.id,
            topicId,
            content: q.content,
            options: q.options,
            correctAnswers: q.correctAnswers,
            explanations: q.explanations,
            subtopicTags: q.subtopicTags,
            scopeItemId: q.scopeItemId,
            contentHash: q.contentHash,
          }))
        )
        .returning();

      return reply.status(201).send({
        session: {
          id: session.id,
          topicId,
          questionCount: missed.length,
          timerEnabled: false,
          mode: "retry",
          createdAt: session.createdAt,
        },
        questions: questionRows.map((q) => ({
          id: q.id,
          content: q.content,
          options: q.options,
          subtopicTags: q.subtopicTags,
          scopeItemId: q.scopeItemId,
          isMultiSelect: format?.isMultiSelect ?? false,
          isFlagged: q.isFlagged,
        })),
      });
    }
  );
}
