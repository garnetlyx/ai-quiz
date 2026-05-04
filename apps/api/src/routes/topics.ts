import { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { topics } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { interpretTopic, detectFormat } from "../services/ai.js";
import { searchWeb } from "../services/search.js";

const createTopicSchema = z.object({
  description: z.string().min(1).max(500),
});

const confirmFormatSchema = z.object({
  confirmed: z.boolean(),
  feedback: z.string().max(500).optional(),
});

export async function topicRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (request) => {
    await app.authenticate(request);
  });

  app.post("/api/topics", async (request, reply) => {
    const parsed = createTopicSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: "Invalid input" });
    }

    const { description } = parsed.data;
    const userId = (request.user as { userId: string }).userId;

    const interpretation = await interpretTopic(description);

    if (interpretation.needsClarification) {
      return reply.send({
        status: "needs_clarification",
        clarification: interpretation.clarification,
        suggestedTopics: interpretation.suggestedTopics,
      });
    }

    const format = await detectFormat(description);

    const [topic] = await db
      .insert(topics)
      .values({
        userId,
        title: interpretation.interpretation?.title ?? description,
        description:
          interpretation.interpretation?.description ?? description,
        examFormat: format,
      })
      .returning();

    return reply.status(201).send({
      status: "format_detected",
      topic,
      examFormat: format,
    });
  });

  app.post("/api/topics/:id/confirm-format", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = confirmFormatSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: "Invalid input" });
    }

    const { confirmed, feedback } = parsed.data;
    const userId = (request.user as { userId: string }).userId;

    const [topic] = await db
      .select()
      .from(topics)
      .where(and(eq(topics.id, id), eq(topics.userId, userId)))
      .limit(1);

    if (!topic) return reply.status(404).send({ message: "Topic not found" });

    if (confirmed) {
      await db
        .update(topics)
        .set({ status: "confirmed" })
        .where(eq(topics.id, id));

      const [updated] = await db
        .select()
        .from(topics)
        .where(eq(topics.id, id))
        .limit(1);

      return reply.send({ topic: updated, examFormat: updated.examFormat });
    }

    if (!feedback) {
      return reply
        .status(400)
        .send({ message: "Feedback required when rejecting format" });
    }

    const searchResults = await searchWeb(
      `${topic.title} exam format questions`
    );
    const searchContext =
      searchResults.length > 0
        ? searchResults.map((r) => r.description).join("\n")
        : undefined;

    const refinedFormat = await detectFormat(
      `${topic.description}\n\nUser feedback: ${feedback}${searchContext ? `\n\nAdditional context from web search:\n${searchContext}` : ""}`
    );

    await db
      .update(topics)
      .set({ examFormat: refinedFormat })
      .where(eq(topics.id, id));

    const [updated] = await db
      .select()
      .from(topics)
      .where(eq(topics.id, id))
      .limit(1);

    return reply.send({ topic: updated, examFormat: refinedFormat });
  });

  app.get("/api/topics", async (request) => {
    const userId = (request.user as { userId: string }).userId;
    return db
      .select()
      .from(topics)
      .where(eq(topics.userId, userId))
      .orderBy(topics.createdAt);
  });

  app.get("/api/topics/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = (request.user as { userId: string }).userId;

    const [topic] = await db
      .select()
      .from(topics)
      .where(and(eq(topics.id, id), eq(topics.userId, userId)))
      .limit(1);

    if (!topic) return reply.status(404).send({ message: "Topic not found" });
    return topic;
  });
}
