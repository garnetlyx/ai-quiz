import "../src/env.js";
import { createHash } from "crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { build } from "../src/app.js";
import { db } from "../src/db/index.js";
import { questions, quizSessions, topics, users } from "../src/db/schema.js";
import { settleSessionAfterGenerationFailure } from "../src/services/quiz.js";

const testEmails: string[] = [];

afterAll(async () => {
  for (const email of testEmails) await db.delete(users).where(eq(users.email, email));
});

describe("settleSessionAfterGenerationFailure", () => {
  it("records the number of questions that exist, so the session is complete at its real size", async () => {
    const email = `gen-failure-${Date.now()}@example.com`;
    const app = await build();
    const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: { email, password: "password123" } });
    await app.close();
    testEmails.push(email);
    const userId = (reg.json() as { user: { id: string } }).user.id;

    const [topic] = await db.insert(topics).values({
      userId, title: "Generation failure", description: "d", scope: { chapters: [] },
      materials: { examples: "", additionalTopics: "", notes: "", instructions: "" },
      examFormat: { choicesCount: 4, isMultiSelect: false }, status: "confirmed",
    }).returning();
    const [session] = await db.insert(quizSessions).values({ topicId: topic.id, questionCount: 5 }).returning();
    for (const label of ["one", "two"]) {
      await db.insert(questions).values({
        sessionId: session.id, topicId: topic.id, content: `Question ${label}`,
        options: [{ id: "A", text: "a" }, { id: "B", text: "b" }, { id: "C", text: "c" }, { id: "D", text: "d" }],
        correctAnswers: [0], explanations: [], contentHash: createHash("sha256").update(label).digest("hex"),
      });
    }

    await settleSessionAfterGenerationFailure(session.id);

    const [after] = await db.select().from(quizSessions).where(eq(quizSessions.id, session.id));
    expect(after.questionCount).toBe(2);
  });
});
