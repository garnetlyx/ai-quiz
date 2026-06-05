import "../src/env.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { inArray } from "drizzle-orm";
import { build } from "../src/app.js";
import { db } from "../src/db/index.js";
import { quizSessions, topics, users } from "../src/db/schema.js";

const testEmails: string[] = [];
let app: FastifyInstance;

async function createTestUser(label: string) {
  const email = `history-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: "test-password-hash" })
    .returning({ id: users.id, email: users.email });

  testEmails.push(email);

  return {
    user,
    token: app.jwt.sign({ userId: user.id }),
  };
}

async function createTestTopic(userId: string, overrides: Partial<typeof topics.$inferInsert> = {}) {
  const [topic] = await db
    .insert(topics)
    .values({
      userId,
      title: "History test topic",
      description: "History route integration test topic",
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
      ...overrides,
    })
    .returning();

  return topic;
}

beforeAll(async () => {
  app = await build();
});

afterAll(async () => {
  if (testEmails.length > 0) {
    await db.delete(users).where(inArray(users.email, testEmails));
  }

  await app.close();
});

describe("history routes", () => {
  it("requires auth for missed questions", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/topics/00000000-0000-4000-8000-000000000001/missed",
    });

    expect(res.statusCode).toBe(401);
  });

  it("requires auth for weak subtopics", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/topics/00000000-0000-4000-8000-000000000001/weak-subtopics",
    });

    expect(res.statusCode).toBe(401);
  });

  it("requires auth for history", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/topics/00000000-0000-4000-8000-000000000001/history",
    });

    expect(res.statusCode).toBe(401);
  });

  it("requires auth for retry", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/topics/00000000-0000-4000-8000-000000000001/quiz/retry",
    });

    expect(res.statusCode).toBe(401);
  });

  it("requires a valid UUID for missed questions", async () => {
    const { token } = await createTestUser("missed-invalid-uuid");

    const res = await app.inject({
      method: "GET",
      url: "/api/topics/not-a-uuid/missed",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
  });

  it("requires a valid UUID for weak subtopics", async () => {
    const { token } = await createTestUser("weak-invalid-uuid");

    const res = await app.inject({
      method: "GET",
      url: "/api/topics/not-a-uuid/weak-subtopics",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns history with default pagination", async () => {
    const { user, token } = await createTestUser("history-default-pagination");
    const topic = await createTestTopic(user.id);
    await db.insert(quizSessions).values([
      {
        topicId: topic.id,
        questionCount: 10,
        timerEnabled: false,
        score: 80,
        completedAt: new Date("2026-01-02T00:00:00.000Z"),
        mode: "normal",
      },
      {
        topicId: topic.id,
        questionCount: 5,
        timerEnabled: true,
        timerDurationSeconds: 300,
        score: 60,
        completedAt: new Date("2026-01-01T00:00:00.000Z"),
        mode: "retry",
      },
    ]);

    const res = await app.inject({
      method: "GET",
      url: `/api/topics/${topic.id}/history`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { sessionId: string; score: number | null; questionCount: number; completedAt: string | null; mode: string }[];
      total: number;
      page: number;
      limit: number;
    };
    expect(body).toEqual({
      data: expect.any(Array),
      total: 2,
      page: 1,
      limit: 20,
    });
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({ score: 80, questionCount: 10, mode: "normal" });
    expect(body.data[1]).toMatchObject({ score: 60, questionCount: 5, mode: "retry" });
  });

  it("respects history pagination params", async () => {
    const { user, token } = await createTestUser("history-param-pagination");
    const topic = await createTestTopic(user.id);
    await db.insert(quizSessions).values(
      Array.from({ length: 6 }, (_, index) => ({
        topicId: topic.id,
        questionCount: index + 1,
        timerEnabled: false,
        score: 50 + index,
        completedAt: new Date(Date.UTC(2026, 0, index + 1)),
        mode: "normal" as const,
      }))
    );

    const res = await app.inject({
      method: "GET",
      url: `/api/topics/${topic.id}/history?page=1&limit=5`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; total: number; page: number; limit: number };
    expect(body.total).toBe(6);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(5);
    expect(body.data).toHaveLength(5);
  });

  it("rejects retry for a topic without a confirmed format", async () => {
    const { user, token } = await createTestUser("retry-null-format");
    const topic = await createTestTopic(user.id, {
      examFormat: null,
      status: "draft",
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/topics/${topic.id}/quiz/retry`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      message: "Topic format not confirmed. Confirm the topic format before retrying.",
    });
  });
});
