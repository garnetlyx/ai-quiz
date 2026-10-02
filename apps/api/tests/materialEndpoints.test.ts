import "../src/env.js";
import { createHash } from "crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { build } from "../src/app.js";
import { db } from "../src/db/index.js";
import { materialImportJobs, materialQuestions, topics, users } from "../src/db/schema.js";

const testEmails: string[] = [];

afterAll(async () => {
  for (const email of testEmails) await db.delete(users).where(eq(users.email, email));
});

async function registerUser(email: string) {
  const app = await build();
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { email, password: "password123" } });
  await app.close();
  expect(res.statusCode).toBe(201);
  testEmails.push(email);
  return res.json() as { user: { id: string }; token: string };
}

async function seedTopicWithBank(userId: string) {
  const [topic] = await db.insert(topics).values({
    userId, title: "Bank topic", description: "d",
    scope: { chapters: [] }, materials: { examples: "", additionalTopics: "", notes: "", instructions: "" },
    examFormat: { choicesCount: 4, isMultiSelect: false }, status: "confirmed",
  }).returning();

  const makeJob = async (fileName: string, createdAt: Date) => {
    const [job] = await db.insert(materialImportJobs).values({
      topicId: topic.id, userId, fileName, filePath: "", mimeType: "application/json",
      status: "completed", progress: 100, summary: {}, createdAt, completedAt: createdAt,
    }).returning();
    return job;
  };
  const olderJob = await makeJob("older.json", new Date("2026-01-01T00:00:00Z"));
  const newerJob = await makeJob("newer.json", new Date("2026-02-01T00:00:00Z"));

  const makeQuestion = async (jobId: string, label: string, reviewStatus: "ready" | "needs_user_review", active: boolean) => {
    const content = `Question ${label}`;
    await db.insert(materialQuestions).values({
      topicId: topic.id, jobId, content,
      options: [{ id: "A", text: "a" }, { id: "B", text: "b" }, { id: "C", text: "c" }, { id: "D", text: "d" }],
      correctAnswers: [0], explanations: [], source: "exam_question", reviewStatus, active,
      contentHash: createHash("sha256").update(content).digest("hex"),
    });
  };
  await makeQuestion(olderJob.id, "superseded review", "needs_user_review", false);
  await makeQuestion(olderJob.id, "superseded ready", "ready", false);
  await makeQuestion(newerJob.id, "current review", "needs_user_review", true);
  await makeQuestion(newerJob.id, "current ready", "ready", true);
  return topic;
}

describe("material endpoints", () => {
  it("lists only active bank questions, so counts exclude superseded imports", async () => {
    const { user, token } = await registerUser(`material-active-${Date.now()}@example.com`);
    const topic = await seedTopicWithBank(user.id);
    const app = await build();
    try {
      const res = await app.inject({ method: "GET", url: `/api/topics/${topic.id}/material-questions`, headers: { authorization: `Bearer ${token}` } });
      expect(res.statusCode).toBe(200);
      const rows = res.json() as { content: string }[];
      expect(rows.map((row) => row.content).sort()).toEqual(["Question current ready", "Question current review"]);

      const filtered = await app.inject({ method: "GET", url: `/api/topics/${topic.id}/material-questions?status=needs_user_review`, headers: { authorization: `Bearer ${token}` } });
      expect((filtered.json() as { content: string }[]).map((row) => row.content)).toEqual(["Question current review"]);
    } finally {
      await app.close();
    }
  });

  it("lists import jobs newest first", async () => {
    const { user, token } = await registerUser(`material-jobs-${Date.now()}@example.com`);
    const topic = await seedTopicWithBank(user.id);
    const app = await build();
    try {
      const res = await app.inject({ method: "GET", url: `/api/topics/${topic.id}/material-imports`, headers: { authorization: `Bearer ${token}` } });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { fileName: string }[]).map((job) => job.fileName)).toEqual(["newer.json", "older.json"]);
    } finally {
      await app.close();
    }
  });
});
