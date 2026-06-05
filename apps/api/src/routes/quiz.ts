import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  generateQuizForTopic,
  submitQuizAnswers,
  getQuizResults,
  flagQuestion,
} from "../services/quiz.js";
import {
  sessionAndQuestionIdParamsSchema,
  sessionIdParamsSchema,
  topicIdParamsSchema,
} from "./validation.js";

const createQuizSchema = z.object({
  questionCount: z.number().int().min(1).max(50),
  timerEnabled: z.boolean().optional(),
  timerDuration: z.number().int().min(1).optional(),
  mode: z.enum(["normal", "retry", "subtopic"]).optional(),
  subtopicFilter: z.array(z.string()).optional(),
});

const submitAnswersSchema = z.object({
  answers: z.record(z.array(z.number().int())),
});

  const flagSchema = z.object({
  reason: z.string().min(1).max(500),
  category: z.enum(["wrong_answer", "misleading_explanation", "question_unclear"]).optional(),
});

export async function quizRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (request) => {
    await app.authenticate(request);
  });

  app.post("/api/topics/:topicId/quiz", async (request, reply) => {
    const { topicId } = topicIdParamsSchema.parse(request.params);
    const parsed = createQuizSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: "Invalid input" });
    }

    const userId = (request.user as { userId: string }).userId;

    try {
      const result = await generateQuizForTopic(
        topicId,
        parsed.data.questionCount,
        userId,
        {
          timerEnabled: parsed.data.timerEnabled,
          timerDurationSeconds: parsed.data.timerDuration,
          mode: parsed.data.mode,
          subtopicFilter: parsed.data.subtopicFilter,
        }
      );

      return reply.status(201).send(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to generate quiz";
      const status = message.includes("not found")
        ? 404
        : message.includes("Forbidden")
          ? 403
          : 500;
      return reply.status(status).send({ message });
    }
  });

  app.post("/api/quiz/:sessionId/submit", async (request, reply) => {
    const { sessionId } = sessionIdParamsSchema.parse(request.params);
    const parsed = submitAnswersSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: "Invalid input" });
    }

    const userId = (request.user as { userId: string }).userId;

    try {
      const result = await submitQuizAnswers(
        sessionId,
        parsed.data.answers,
        userId
      );
      return reply.send(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to submit answers";
      const status = message.includes("not found")
        ? 404
        : message.includes("Forbidden")
          ? 403
          : 500;
      return reply.status(status).send({ message });
    }
  });

  app.get("/api/quiz/:sessionId", async (request, reply) => {
    const { sessionId } = sessionIdParamsSchema.parse(request.params);
    const userId = (request.user as { userId: string }).userId;

    try {
      const result = await getQuizResults(sessionId, userId);
      return reply.send(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to get results";
      const status = message.includes("not found")
        ? 404
        : message.includes("Forbidden")
          ? 403
          : 500;
      return reply.status(status).send({ message });
    }
  });

  app.post(
    "/api/quiz/:sessionId/questions/:questionId/flag",
    async (request, reply) => {
      const { sessionId, questionId } = sessionAndQuestionIdParamsSchema.parse(request.params);
      const parsed = flagSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ message: "Reason is required" });
      }

      const userId = (request.user as { userId: string }).userId;

      try {
        await flagQuestion(sessionId, questionId, parsed.data.reason, userId, parsed.data.category);
        return reply.send({ success: true });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to flag question";
        const status = message.includes("not found")
          ? 404
          : message.includes("Forbidden")
            ? 403
            : 500;
        return reply.status(status).send({ message });
      }
    }
  );
}
