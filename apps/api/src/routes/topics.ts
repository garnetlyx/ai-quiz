import { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { questions, topics } from "../db/schema.js";
import { eq, and, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { interpretTopic, detectFormat, generateScope } from "../services/ai.js";
import { searchWeb } from "../services/search.js";
import {
  DEFAULT_MATERIALS,
  assertScopeIsUsable,
  defaultScope,
  mergeScopeWithUsage,
  normalizeMaterials,
  normalizeScope,
} from "../services/scope.js";

const createTopicSchema = z.object({
  description: z.string().min(1).max(500),
});

const scopeItemSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1).max(200),
  details: z.string().max(1000).optional().default(""),
  frozen: z.boolean().optional().default(false),
});

const scopeSchema = z.object({
  chapters: z.array(
    z.object({
      id: z.string().optional(),
      title: z.string().min(1).max(200),
      items: z.array(scopeItemSchema).min(1).max(100),
    })
  ).min(1).max(20),
});

const updateTopicSchema = z.object({
  description: z.string().min(1).max(500),
  scope: scopeSchema,
  materials: z.object({
    examples: z.string().max(4000).optional().default(""),
    additionalTopics: z.string().max(2000).optional().default(""),
    notes: z.string().max(4000).optional().default(""),
  }),
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
    let scope = defaultScope(description);
    try {
      const generatedScope = await generateScope(
        interpretation.interpretation?.description ?? description
      );
      scope = normalizeScope(generatedScope);
      assertScopeIsUsable(scope);
    } catch {
      scope = defaultScope(description);
    }

    const [topic] = await db
      .insert(topics)
      .values({
        userId,
        title: interpretation.interpretation?.title ?? description,
        description:
          interpretation.interpretation?.description ?? description,
        scope,
        materials: DEFAULT_MATERIALS,
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

  app.patch("/api/topics/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateTopicSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Invalid input",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const userId = (request.user as { userId: string }).userId;
    const [topic] = await db
      .select()
      .from(topics)
      .where(and(eq(topics.id, id), eq(topics.userId, userId)))
      .limit(1);

    if (!topic) return reply.status(404).send({ message: "Topic not found" });

    const usedRows = await db
      .select({ scopeItemId: questions.scopeItemId })
      .from(questions)
      .where(and(eq(questions.topicId, id), isNotNull(questions.scopeItemId)));
    const usedItemIds = new Set(
      usedRows.map((row) => row.scopeItemId).filter((value): value is string => Boolean(value))
    );
    const scope = mergeScopeWithUsage(
      normalizeScope(topic.scope),
      normalizeScope(parsed.data.scope),
      usedItemIds
    );

    try {
      assertScopeIsUsable(scope);
    } catch (err) {
      return reply.status(400).send({
        message: err instanceof Error ? err.message : "Invalid scope",
      });
    }

    const [updated] = await db
      .update(topics)
      .set({
        description: parsed.data.description,
        scope,
        materials: normalizeMaterials(parsed.data.materials),
      })
      .where(eq(topics.id, id))
      .returning();

    return reply.send(updated);
  });
}
