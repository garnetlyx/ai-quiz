import "../src/env.js";
import { createHash, randomUUID } from "crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { build } from "../src/app.js";
import { db } from "../src/db/index.js";
import { materialImportJobs, materialQuestions, topics, users } from "../src/db/schema.js";

const testEmails: string[] = [];

async function registerUser(email: string) {
  const app = await build();
  const res = await app.inject({
    method: "POST", url: "/api/auth/register",
    payload: { email, password: "password123" },
  });
  await app.close();
  expect(res.statusCode).toBe(201);
  testEmails.push(email);
  return res.json() as { user: { id: string }; token: string };
}

async function createConfirmedTopic(userId: string, title: string) {
  const [topic] = await db
    .insert(topics)
    .values({
      userId,
      title,
      description: `${title} description`,
      scope: {
        chapters: [
          {
            id: "chapter-1",
            title: "Chapter 1",
            items: [{ id: "item-1", title: "Item 1", details: "", frozen: false }],
          },
        ],
      },
      materials: { examples: "", additionalTopics: "", notes: "", instructions: "" },
      examFormat: { choicesCount: 4, isMultiSelect: false },
      status: "confirmed",
    })
    .returning();

  return topic;
}

async function seedMaterialQuestion(topicId: string, userId: string) {
  const [job] = await db
    .insert(materialImportJobs)
    .values({
      topicId,
      userId,
      fileName: "quiz-flow.txt",
      filePath: "/tmp/quiz-flow.txt",
      mimeType: "text/plain",
      status: "completed",
      progress: 100,
      summary: { questionCount: 1 },
      completedAt: new Date(),
    })
    .returning();

  const content = `What does ${topicId} test?`;
  const [question] = await db
    .insert(materialQuestions)
    .values({
      topicId,
      jobId: job.id,
      content,
      options: [
        { id: "A", text: "The seeded material question path" },
        { id: "B", text: "An unrelated distractor" },
        { id: "C", text: "A second unrelated distractor" },
        { id: "D", text: "A third unrelated distractor" },
      ],
      correctAnswers: [0],
      explanations: [
        { optionIndex: 0, text: "The seeded material question is used before AI generation." },
        { optionIndex: 1, text: "This option is not correct." },
        { optionIndex: 2, text: "This option is not correct." },
        { optionIndex: 3, text: "This option is not correct." },
      ],
      subtopicTags: ["Item 1"],
      scopeItemId: "item-1",
      source: "quiz-flow.txt",
      sourceLocation: { page: 1 },
      confidence: 1,
      reviewStatus: "ready",
      active: true,
      contentHash: createHash("sha256").update(content).digest("hex"),
    })
    .returning();

  return question;
}

afterAll(async () => {
  if (testEmails.length === 0) return;
  for (const email of testEmails) {
    await db.delete(users).where(eq(users.email, email));
  }
});

describe("quiz routes", () => {
  it("requires auth to create a quiz", async () => {
    const app = await build();
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/topics/${randomUUID()}/quiz`,
        payload: { questionCount: 1 },
      });

      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("requires a valid topicId UUID to create a quiz", async () => {
    const { token } = await registerUser(`quiz-invalid-topic-${Date.now()}@example.com`);
    const app = await build();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/topics/not-a-uuid/quiz",
        headers: { authorization: `Bearer ${token}` },
        payload: { questionCount: 1 },
      });

      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("returns not found when creating a quiz for a nonexistent topic", async () => {
    const { token } = await registerUser(`quiz-missing-topic-${Date.now()}@example.com`);
    const app = await build();
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/topics/${randomUUID()}/quiz`,
        headers: { authorization: `Bearer ${token}` },
        payload: { questionCount: 1 },
      });

      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("requires auth to submit answers", async () => {
    const app = await build();
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/quiz/${randomUUID()}/submit`,
        payload: { answers: {} },
      });

      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("requires auth to get a quiz", async () => {
    const app = await build();
    try {
      const res = await app.inject({
        method: "GET",
        url: `/api/quiz/${randomUUID()}`,
      });

      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("requires auth to flag a question", async () => {
    const app = await build();
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/quiz/${randomUUID()}/questions/${randomUUID()}/flag`,
        payload: { reason: "Needs review" },
      });

      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("creates a quiz from material questions and submits answers", async () => {
    const { user, token } = await registerUser(`quiz-flow-${Date.now()}@example.com`);
    const topic = await createConfirmedTopic(user.id, "Material quiz flow");
    await seedMaterialQuestion(topic.id, user.id);
    const app = await build();
    try {
      const createRes = await app.inject({
        method: "POST",
        url: `/api/topics/${topic.id}/quiz`,
        headers: { authorization: `Bearer ${token}` },
        payload: { questionCount: 1 },
      });

      expect(createRes.statusCode).toBe(201);
      const created = createRes.json() as {
        session: { id: string; questionCount: number };
        questions: { id: string; content: string; isMultiSelect: boolean }[];
      };
      expect(created.session.questionCount).toBe(1);
      expect(created.questions).toHaveLength(1);
      expect(created.questions[0].content).toContain(topic.id);
      expect(created.questions[0].isMultiSelect).toBe(false);

      const getRes = await app.inject({
        method: "GET",
        url: `/api/quiz/${created.session.id}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(getRes.statusCode).toBe(200);
      expect((getRes.json() as { questions: { id: string }[] }).questions).toHaveLength(1);

      const submitRes = await app.inject({
        method: "POST",
        url: `/api/quiz/${created.session.id}/submit`,
        headers: { authorization: `Bearer ${token}` },
        payload: { answers: { [created.questions[0].id]: [0] } },
      });

      expect(submitRes.statusCode).toBe(200);
      const submitted = submitRes.json() as {
        session: { id: string; score: number; questionCount: number };
        score: number;
        totalQuestions: number;
      };
      expect(submitted.session.id).toBe(created.session.id);
      expect(submitted.session.questionCount).toBe(1);
      expect(submitted.score).toBe(100);
      expect(submitted.totalQuestions).toBe(1);
    } finally {
      await app.close();
    }
  });
});
