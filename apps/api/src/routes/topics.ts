import { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import {
  materialImportJobs,
  materialQuestions,
  materialTextChunks,
  quizSessions,
  questions,
  topics,
  topicUpdateSuggestions,
  users,
} from "../db/schema.js";
import { eq, and, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { interpretTopic, detectFormat, generateScope, isValidAgent, type AiAgent } from "../services/ai.js";
import { searchWeb } from "../services/search.js";
import {
  DEFAULT_MATERIALS,
  assertScopeIsUsable,
  defaultScope,
  mergeSuggestedScope,
  mergeScopeWithUsage,
  normalizeMaterials,
  normalizeScope,
} from "../services/scope.js";
import { createMaterialImportJob, processPastedContent, refreshMaterialImportSummary } from "../services/materialImport.js";
import {
  idAndJobIdParamsSchema,
  idAndQuestionIdParamsSchema,
  idAndSuggestionIdParamsSchema,
  idParamsSchema,
} from "./validation.js";

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
    instructions: z.string().max(4000).optional().default(""),
  }),
});

const confirmFormatSchema = z.object({
  confirmed: z.boolean(),
  feedback: z.string().max(500).optional(),
});

const materialQuestionUpdateSchema = z.object({
  reviewStatus: z.enum(["ready", "auto_repaired", "needs_repair", "needs_user_review", "unresolved"]).optional(),
  content: z.string().min(1).max(4000).optional(),
  options: z.array(z.object({ id: z.string(), text: z.string().min(1) })).min(2).max(8).optional(),
  correctAnswers: z.array(z.number().int().min(0)).optional(),
  active: z.boolean().optional(),
  convertToContentKind: z.enum(["structure", "context", "definition"]).optional(),
});

const suggestionUpdateSchema = z.object({
  status: z.enum(["approved", "rejected"]),
});

function serializeTopic<T extends { scope: unknown; materials: unknown }>(topic: T) {
  return {
    ...topic,
    scope: normalizeScope(topic.scope),
    materials: normalizeMaterials(topic.materials),
  };
}

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

    const [user] = await db.select({ aiAgent: users.aiAgent }).from(users).where(eq(users.id, userId)).limit(1);
    const agent: AiAgent = user?.aiAgent && isValidAgent(user.aiAgent) ? user.aiAgent : "glm";

    const interpretation = await interpretTopic(description, agent);

    if (interpretation.needsClarification) {
      return reply.send({
        status: "needs_clarification",
        clarification: interpretation.clarification,
        suggestedTopics: interpretation.suggestedTopics,
      });
    }

    const format = await detectFormat(description, agent);
    let scope = defaultScope(description);
    try {
      const generatedScope = await generateScope(
        interpretation.interpretation?.description ?? description,
        agent
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
      topic: serializeTopic(topic),
      examFormat: format,
    });
  });

  app.post("/api/topics/:id/confirm-format", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const parsed = confirmFormatSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: "Invalid input" });
    }

    const { confirmed, feedback } = parsed.data;
    const userId = (request.user as { userId: string }).userId;

    const [userRow] = await db.select({ aiAgent: users.aiAgent }).from(users).where(eq(users.id, userId)).limit(1);
    const confirmAgent: AiAgent = userRow?.aiAgent && isValidAgent(userRow.aiAgent) ? userRow.aiAgent : "glm";

    const [topic] = await db
      .select()
      .from(topics)
      .where(
        and(eq(topics.id, id), eq(topics.userId, userId), isNull(topics.archivedAt))
      )
      .limit(1);

    if (!topic) return reply.status(404).send({ message: "Topic not found" });

    if (confirmed) {
      await db
        .update(topics)
        .set({ status: "confirmed" })
        .where(and(eq(topics.id, id), isNull(topics.archivedAt)));

      const [updated] = await db
        .select()
        .from(topics)
        .where(and(eq(topics.id, id), isNull(topics.archivedAt)))
        .limit(1);

      if (!updated) return reply.status(404).send({ message: "Topic not found" });

      return reply.send({ topic: serializeTopic(updated), examFormat: updated.examFormat });
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
      `${topic.description}\n\nUser feedback: ${feedback}${searchContext ? `\n\nAdditional context from web search:\n${searchContext}` : ""}`,
      confirmAgent
    );

    await db
      .update(topics)
      .set({ examFormat: refinedFormat })
      .where(and(eq(topics.id, id), isNull(topics.archivedAt)));

    const [updated] = await db
      .select()
      .from(topics)
      .where(and(eq(topics.id, id), isNull(topics.archivedAt)))
      .limit(1);

    if (!updated) return reply.status(404).send({ message: "Topic not found" });

    return reply.send({ topic: serializeTopic(updated), examFormat: refinedFormat });
  });

  app.get("/api/topics", async (request) => {
    const userId = (request.user as { userId: string }).userId;
    const rows = await db
      .select()
      .from(topics)
      .where(and(eq(topics.userId, userId), isNull(topics.archivedAt)))
      .orderBy(topics.createdAt);
    return rows.map(serializeTopic);
  });

  app.get("/api/topics/:id", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const userId = (request.user as { userId: string }).userId;

    const [topic] = await db
      .select()
      .from(topics)
      .where(
        and(eq(topics.id, id), eq(topics.userId, userId), isNull(topics.archivedAt))
      )
      .limit(1);

    if (!topic) return reply.status(404).send({ message: "Topic not found" });
    return serializeTopic(topic);
  });

  app.post("/api/topics/:id/material-imports", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const userId = (request.user as { userId: string }).userId;
    const parts = request.files();
    const jobs = [];

    for await (const part of parts) {
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const job = await createMaterialImportJob({
        topicId: id,
        userId,
        fileName: part.filename || "upload",
        mimeType: part.mimetype || "application/octet-stream",
        content: Buffer.concat(chunks),
      });
      jobs.push(job);
    }

    if (jobs.length === 0) return reply.status(400).send({ message: "No files uploaded" });
    return reply.status(202).send({ jobs });
  });

  app.get("/api/topics/:id/material-imports", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const userId = (request.user as { userId: string }).userId;
    const [topic] = await db
      .select()
      .from(topics)
      .where(and(eq(topics.id, id), eq(topics.userId, userId), isNull(topics.archivedAt)))
      .limit(1);
    if (!topic) return reply.status(404).send({ message: "Topic not found" });

    return db
      .select()
      .from(materialImportJobs)
      .where(and(eq(materialImportJobs.topicId, id), eq(materialImportJobs.userId, userId)))
      .orderBy(materialImportJobs.createdAt);
  });

  app.get("/api/topics/:id/material-imports/:jobId", async (request, reply) => {
    const { id, jobId } = idAndJobIdParamsSchema.parse(request.params);
    const userId = (request.user as { userId: string }).userId;
    const [job] = await db
      .select()
      .from(materialImportJobs)
      .where(and(eq(materialImportJobs.id, jobId), eq(materialImportJobs.topicId, id), eq(materialImportJobs.userId, userId)))
      .limit(1);
    if (!job) return reply.status(404).send({ message: "Import job not found" });
    return job;
  });

  app.get("/api/topics/:id/material-questions", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const { status } = request.query as {
      status?: "ready" | "auto_repaired" | "needs_repair" | "needs_user_review" | "unresolved";
    };
    const userId = (request.user as { userId: string }).userId;
    const [topic] = await db
      .select()
      .from(topics)
      .where(and(eq(topics.id, id), eq(topics.userId, userId), isNull(topics.archivedAt)))
      .limit(1);
    if (!topic) return reply.status(404).send({ message: "Topic not found" });
    const rows = await db.select().from(materialQuestions).where(eq(materialQuestions.topicId, id));
    return status ? rows.filter((row) => row.reviewStatus === status) : rows;
  });

  app.patch("/api/topics/:id/material-questions/:questionId", async (request, reply) => {
    const { id, questionId } = idAndQuestionIdParamsSchema.parse(request.params);
    const parsed = materialQuestionUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: "Invalid input" });
    const userId = (request.user as { userId: string }).userId;
    const [topic] = await db
      .select()
      .from(topics)
      .where(and(eq(topics.id, id), eq(topics.userId, userId), isNull(topics.archivedAt)))
      .limit(1);
    if (!topic) return reply.status(404).send({ message: "Topic not found" });

    const { convertToContentKind, ...questionUpdate } = parsed.data;
    const [existingQuestion] = await db
      .select()
      .from(materialQuestions)
      .where(and(eq(materialQuestions.id, questionId), eq(materialQuestions.topicId, id)))
      .limit(1);
    if (!existingQuestion) return reply.status(404).send({ message: "Material question not found" });

    if (convertToContentKind) {
      await db.insert(materialTextChunks).values({
        topicId: id,
        jobId: existingQuestion.jobId,
        kind: convertToContentKind,
        content: existingQuestion.content,
        labels: [convertToContentKind, existingQuestion.source],
        sourceLocation: existingQuestion.sourceLocation,
        confidence: existingQuestion.confidence,
        active: true,
      });
      questionUpdate.active = false;
      questionUpdate.reviewStatus = "unresolved";
    }

    const [updated] = await db
      .update(materialQuestions)
      .set({ ...questionUpdate, updatedAt: new Date() })
      .where(and(eq(materialQuestions.id, questionId), eq(materialQuestions.topicId, id)))
      .returning();
    if (!updated) return reply.status(404).send({ message: "Material question not found" });
    await refreshMaterialImportSummary(existingQuestion.jobId);
    return updated;
  });

  app.get("/api/topics/:id/material-text-chunks", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const userId = (request.user as { userId: string }).userId;
    const [topic] = await db
      .select()
      .from(topics)
      .where(and(eq(topics.id, id), eq(topics.userId, userId), isNull(topics.archivedAt)))
      .limit(1);
    if (!topic) return reply.status(404).send({ message: "Topic not found" });
    return db.select().from(materialTextChunks).where(eq(materialTextChunks.topicId, id));
  });

  app.get("/api/topics/:id/material-suggestions", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const userId = (request.user as { userId: string }).userId;
    const [topic] = await db
      .select()
      .from(topics)
      .where(and(eq(topics.id, id), eq(topics.userId, userId), isNull(topics.archivedAt)))
      .limit(1);
    if (!topic) return reply.status(404).send({ message: "Topic not found" });
    return db.select().from(topicUpdateSuggestions).where(eq(topicUpdateSuggestions.topicId, id));
  });

  app.patch("/api/topics/:id/material-suggestions/:suggestionId", async (request, reply) => {
    const { id, suggestionId } = idAndSuggestionIdParamsSchema.parse(request.params);
    const parsed = suggestionUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: "Invalid input" });
    const userId = (request.user as { userId: string }).userId;
    const [topic] = await db
      .select()
      .from(topics)
      .where(and(eq(topics.id, id), eq(topics.userId, userId), isNull(topics.archivedAt)))
      .limit(1);
    if (!topic) return reply.status(404).send({ message: "Topic not found" });

    const [suggestion] = await db
      .update(topicUpdateSuggestions)
      .set({ status: parsed.data.status, updatedAt: new Date() })
      .where(and(eq(topicUpdateSuggestions.id, suggestionId), eq(topicUpdateSuggestions.topicId, id)))
      .returning();
    if (!suggestion) return reply.status(404).send({ message: "Suggestion not found" });

    if (parsed.data.status === "approved" && suggestion.type === "definition") {
      const payload = suggestion.payload as { instructions?: string };
      const materials = normalizeMaterials(topic.materials);
      await db
        .update(topics)
        .set({
          materials: {
            ...materials,
            instructions: [materials.instructions, payload.instructions || ""].filter(Boolean).join("\n\n").slice(0, 4000),
          },
        })
        .where(eq(topics.id, id));
    }

    if (parsed.data.status === "approved" && suggestion.type === "scope") {
      const payload = suggestion.payload as {
        chapters?: { title?: string; items?: { title?: string; details?: string }[] }[];
        suggestedLabels?: string[];
      };
      const fallbackChapters = payload.suggestedLabels && payload.suggestedLabels.length > 0
        ? [{ title: "Imported structure", items: payload.suggestedLabels.map((title) => ({ title, details: "" })) }]
        : [];
      const nextScope = mergeSuggestedScope(
        normalizeScope(topic.scope),
        normalizeScope({ chapters: payload.chapters || fallbackChapters })
      );
      await db
        .update(topics)
        .set({ scope: nextScope })
        .where(eq(topics.id, id));
    }

    return suggestion;
  });

  app.patch("/api/topics/:id", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
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
      .where(
        and(eq(topics.id, id), eq(topics.userId, userId), isNull(topics.archivedAt))
      )
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
      .where(and(eq(topics.id, id), isNull(topics.archivedAt)))
      .returning();

    if (!updated) return reply.status(404).send({ message: "Topic not found" });

    return reply.send(serializeTopic(updated));
  });

  const resetSchema = z.object({ scope: z.enum(["history", "questions", "all"]) });

  app.delete("/api/topics/:id/reset", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const parsed = resetSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: "Invalid scope" });

    const userId = (request.user as { userId: string }).userId;
    const [topic] = await db
      .select()
      .from(topics)
      .where(and(eq(topics.id, id), eq(topics.userId, userId), isNull(topics.archivedAt)))
      .limit(1);
    if (!topic) return reply.status(404).send({ message: "Topic not found" });

    const scope = parsed.data.scope;
    let deletedSessions = 0;
    let deletedMaterialQuestions = 0;

    if (scope === "history" || scope === "all") {
      const deleted = await db
        .delete(quizSessions)
        .where(eq(quizSessions.topicId, id))
        .returning({ id: quizSessions.id });
      deletedSessions = deleted.length;
    }

    if (scope === "questions" || scope === "all") {
      const deletedQ = await db
        .delete(materialQuestions)
        .where(eq(materialQuestions.topicId, id))
        .returning({ id: materialQuestions.id });
      deletedMaterialQuestions = deletedQ.length;
      await db.delete(materialTextChunks).where(eq(materialTextChunks.topicId, id));
      await db.delete(topicUpdateSuggestions).where(eq(topicUpdateSuggestions.topicId, id));
      await db.delete(materialImportJobs).where(eq(materialImportJobs.topicId, id));
    }

    return reply.send({ message: "Topic data reset", deletedSessions, deletedMaterialQuestions });
  });

  app.post("/api/topics/:id/paste-import", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const userId = (request.user as { userId: string }).userId;

    const [topic] = await db
      .select()
      .from(topics)
      .where(and(eq(topics.id, id), eq(topics.userId, userId), isNull(topics.archivedAt)))
      .limit(1);
    if (!topic) return reply.status(404).send({ message: "Topic not found" });

    let textValue = "";
    const files: { fileName: string; mimeType: string; content: Buffer }[] = [];

    for await (const part of request.parts()) {
      if (part.type === "field" && part.fieldname === "text") {
        textValue = part.value as string;
      } else if (part.type === "file") {
        const buffer = await part.toBuffer();
        files.push({ fileName: part.filename, mimeType: part.mimetype, content: buffer });
      }
    }

    if (!textValue.trim() && files.length === 0) {
      return reply.status(400).send({ message: "Provide text or files to import" });
    }

    const result = await processPastedContent({
      topicId: id,
      userId,
      text: textValue,
      files: files.length > 0 ? files : undefined,
    });

    return reply.send(result);
  });

  app.delete("/api/topics/:id", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const userId = (request.user as { userId: string }).userId;

    const [archived] = await db
      .update(topics)
      .set({ archivedAt: new Date() })
      .where(
        and(eq(topics.id, id), eq(topics.userId, userId), isNull(topics.archivedAt))
      )
      .returning({ id: topics.id });

    if (!archived) return reply.status(404).send({ message: "Topic not found" });

    return reply.send({ success: true });
  });
}
