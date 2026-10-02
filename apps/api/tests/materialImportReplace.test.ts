import "../src/env.js";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { build } from "../src/app.js";
import { db } from "../src/db/index.js";
import { materialQuestions, topics, users } from "../src/db/schema.js";
import { importMaterialQuestions } from "../src/services/materialImport.js";
import { materialQuestionFixture } from "./helpers/materialQuestion.js";

const testEmails: string[] = [];

afterAll(async () => {
  for (const email of testEmails) await db.delete(users).where(eq(users.email, email));
});

async function createTopic(): Promise<string> {
  const email = `import-replace-${Date.now()}@example.com`;
  const app = await build();
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { email, password: "password123" } });
  await app.close();
  testEmails.push(email);
  const userId = (res.json() as { user: { id: string } }).user.id;
  const [topic] = await db.insert(topics).values({
    userId, title: "Import replace", description: "d", scope: { chapters: [] },
    materials: { examples: "", additionalTopics: "", notes: "", instructions: "" },
    examFormat: { choicesCount: 4, isMultiSelect: false }, status: "confirmed",
  }).returning();
  return topic.id;
}

const bankOf = (labels: string[]) =>
  labels.map((label) => materialQuestionFixture({ id: label, question: `Question ${label}`, contentHash: `hash-${label}` }));

describe("importMaterialQuestions with replaceExisting", () => {
  it("replaces the previous bank without leaving retired rows behind", async () => {
    const topicId = await createTopic();
    await importMaterialQuestions({ topicId, questions: bankOf(["a", "b", "c"]), replaceExisting: false });
    const second = await importMaterialQuestions({ topicId, questions: bankOf(["b", "c", "d"]), replaceExisting: true });

    const rows = await db.select().from(materialQuestions).where(eq(materialQuestions.topicId, topicId));
    expect(rows.map((row) => row.content).sort()).toEqual(["Question b", "Question c", "Question d"]);
    expect(rows.every((row) => row.active)).toBe(true);
    expect(second.insertedCount).toBe(3);
  });

  it("keeps a question the user excluded from the bank excluded", async () => {
    const topicId = await createTopic();
    await importMaterialQuestions({ topicId, questions: bankOf(["keep", "drop"]), replaceExisting: false });
    await db.update(materialQuestions).set({ active: false }).where(eq(materialQuestions.content, "Question drop"));

    await importMaterialQuestions({ topicId, questions: bankOf(["keep", "new"]), replaceExisting: true });

    const rows = await db.select().from(materialQuestions).where(eq(materialQuestions.topicId, topicId));
    expect(rows.filter((row) => row.active).map((row) => row.content).sort()).toEqual(["Question keep", "Question new"]);
    expect(rows.filter((row) => !row.active).map((row) => row.content)).toEqual(["Question drop"]);
  });
});
