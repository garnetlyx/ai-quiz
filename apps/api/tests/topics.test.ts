import "../src/env.js";
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { build } from "../src/app.js";
import { db } from "../src/db/index.js";
import { materialImportJobs, materialQuestions, materialTextChunks, topicUpdateSuggestions, topics, users } from "../src/db/schema.js";
import { normalizeMaterials } from "../src/services/scope.js";

const testEmails: string[] = [];

async function registerUser(email: string) {
  const app = await build();
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: "password123" },
  });
  await app.close();

  expect(res.statusCode).toBe(201);
  const body = res.json() as { user: { id: string }; token: string };
  testEmails.push(email);
  return body;
}

async function createTopic(userId: string, title: string) {
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

afterAll(async () => {
  if (testEmails.length === 0) return;
  for (const email of testEmails) {
    await db.delete(users).where(eq(users.email, email));
  }
});

describe("topic archive routes", () => {
  it("archives a topic and removes it from normal topic APIs", async () => {
    const email = `archive-${Date.now()}@example.com`;
    const { user, token } = await registerUser(email);
    const topic = await createTopic(user.id, "Archived topic");
    const app = await build();

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/api/topics/${topic.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json()).toEqual({ success: true });

    const listRes = await app.inject({
      method: "GET",
      url: "/api/topics",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listRes.statusCode).toBe(200);
    expect((listRes.json() as { id: string }[]).map((item) => item.id)).not.toContain(topic.id);

    const detailRes = await app.inject({
      method: "GET",
      url: `/api/topics/${topic.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(detailRes.statusCode).toBe(404);

    const updateRes = await app.inject({
      method: "PATCH",
      url: `/api/topics/${topic.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        description: topic.description,
        scope: topic.scope,
        materials: topic.materials,
      },
    });
    expect(updateRes.statusCode).toBe(404);

    const [archived] = await db
      .select({ archivedAt: topics.archivedAt })
      .from(topics)
      .where(and(eq(topics.id, topic.id), eq(topics.userId, user.id)))
      .limit(1);
    expect(archived.archivedAt).toBeInstanceOf(Date);

    await app.close();
  });

  it("does not archive another user's topic", async () => {
    const owner = await registerUser(`owner-${Date.now()}@example.com`);
    const other = await registerUser(`other-${Date.now()}@example.com`);
    const topic = await createTopic(owner.user.id, "Private topic");
    const app = await build();

    const res = await app.inject({
      method: "DELETE",
      url: `/api/topics/${topic.id}`,
      headers: { authorization: `Bearer ${other.token}` },
    });

    expect(res.statusCode).toBe(404);

    const [unchanged] = await db
      .select({ archivedAt: topics.archivedAt })
      .from(topics)
      .where(eq(topics.id, topic.id))
      .limit(1);
    expect(unchanged.archivedAt).toBeNull();

    await app.close();
  });
});

describe("material import routes", () => {
  it("uploads text material and exposes extracted questions", async () => {
    const email = `materials-${Date.now()}@example.com`;
    const { user, token } = await registerUser(email);
    const topic = await createTopic(user.id, "Materials topic");
    const app = await build();

    const boundary = "----aiquizboundary";
    const content = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="files"; filename="sample.txt"',
      "Content-Type: text/plain",
      "",
      `Sample Questions
Which document transfers personal property?
A. Deed
B. Bill of sale
C. Mortgage
D. Lease
B. A bill of sale transfers personal property.

Japanese N2 exam explanations should be in Japanese and English.

Key point: fixtures are attached to real property.`,
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const res = await app.inject({
      method: "POST",
      url: `/api/topics/${topic.id}/material-imports`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: content,
    });

    expect(res.statusCode).toBe(202);

    await new Promise((resolve) => setTimeout(resolve, 300));

    const jobsRes = await app.inject({
      method: "GET",
      url: `/api/topics/${topic.id}/material-imports`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(jobsRes.statusCode).toBe(200);
    const jobs = jobsRes.json() as { status: string; summary: { questionCount?: number } }[];
    expect(jobs[0]?.status).toBe("completed");
    expect(jobs[0]?.summary.questionCount).toBeGreaterThan(0);

    const questionsRes = await app.inject({
      method: "GET",
      url: `/api/topics/${topic.id}/material-questions`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(questionsRes.statusCode).toBe(200);
    expect((questionsRes.json() as { content: string }[])[0]?.content).toContain("Which document");

    const chunks = await db
      .select()
      .from(materialTextChunks)
      .where(eq(materialTextChunks.topicId, topic.id));
    expect(chunks.map((chunk) => chunk.content).join("\n")).not.toContain("Which document");
    expect(chunks.some((chunk) => chunk.kind === "definition")).toBe(true);
    expect(chunks.some((chunk) => chunk.kind === "context")).toBe(true);

    await app.close();
  });

  it("applies structure and instruction suggestions from uploaded helpful content", async () => {
    const email = `suggestions-${Date.now()}@example.com`;
    const { user, token } = await registerUser(email);
    const topic = await createTopic(user.id, "Suggestion topic");
    const app = await build();

    const boundary = "----aiquizsuggestionsboundary";
    const content = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="files"; filename="suggestions.txt"',
      "Content-Type: text/plain",
      "",
      `Sample Questions
Which document transfers personal property?
A. Deed
B. Bill of sale
C. Mortgage
D. Lease
B. A bill of sale transfers personal property.

Syllabus
Chapter 2: Contracts
1. Contract formation
2. Breach remedies

Japanese N2 exam explanations should be in Japanese and English.

Key point: written contracts need offer, acceptance, and consideration.`,
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const uploadRes = await app.inject({
      method: "POST",
      url: `/api/topics/${topic.id}/material-imports`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: content,
    });
    expect(uploadRes.statusCode).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const chunks = await db
      .select()
      .from(materialTextChunks)
      .where(eq(materialTextChunks.topicId, topic.id));
    expect(chunks.some((chunk) => chunk.kind === "structure")).toBe(true);
    expect(chunks.some((chunk) => chunk.kind === "definition")).toBe(true);
    expect(chunks.some((chunk) => chunk.kind === "context")).toBe(true);

    const suggestions = await db
      .select()
      .from(topicUpdateSuggestions)
      .where(eq(topicUpdateSuggestions.topicId, topic.id));
    const scopeSuggestion = suggestions.find((suggestion) => suggestion.type === "scope");
    const definitionSuggestion = suggestions.find((suggestion) => suggestion.type === "definition");
    expect(scopeSuggestion).toBeTruthy();
    expect(definitionSuggestion).toBeTruthy();

    const approveDefinitionRes = await app.inject({
      method: "PATCH",
      url: `/api/topics/${topic.id}/material-suggestions/${definitionSuggestion!.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: "approved" },
    });
    expect(approveDefinitionRes.statusCode).toBe(200);

    const [topicAfterDefinition] = await db
      .select()
      .from(topics)
      .where(eq(topics.id, topic.id))
      .limit(1);
    expect(normalizeMaterials(topicAfterDefinition.materials).instructions).toContain(
      "Japanese N2 exam explanations should be in Japanese and English."
    );

    const approveScopeRes = await app.inject({
      method: "PATCH",
      url: `/api/topics/${topic.id}/material-suggestions/${scopeSuggestion!.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: "approved" },
    });
    expect(approveScopeRes.statusCode).toBe(200);

    const topicRes = await app.inject({
      method: "GET",
      url: `/api/topics/${topic.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(topicRes.statusCode).toBe(200);
    const updatedTopic = topicRes.json() as { scope: { chapters: { title: string; items: { title: string }[] }[] } };
    expect(updatedTopic.scope.chapters.some((chapter) => chapter.title === "Chapter 2: Contracts")).toBe(true);
    const contractsChapter = updatedTopic.scope.chapters.find((chapter) => chapter.title === "Chapter 2: Contracts");
    expect(contractsChapter?.items.map((item) => item.title)).toEqual(
      expect.arrayContaining(["Contract formation", "Breach remedies"])
    );

    await app.close();
  });

  it("keeps malformed uploaded questions visible with repair metadata", async () => {
    const email = `repair-visible-${Date.now()}@example.com`;
    const { user, token } = await registerUser(email);
    const topic = await createTopic(user.id, "Repair visible topic");
    const app = await build();

    const boundary = "----aiquizrepairboundary";
    const content = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="files"; filename="repair.txt"',
      "Content-Type: text/plain",
      "",
      `Chapter 1: Property
Chapter Quiz
1. Mineral rights associated with real property are always:
B. separable and divisible
C. sold separately from the property
D. an interest in personal property
Answer Key
1. A. Mineral rights are an interest in real property.`,
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const uploadRes = await app.inject({
      method: "POST",
      url: `/api/topics/${topic.id}/material-imports`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: content,
    });

    expect(uploadRes.statusCode).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const questionsRes = await app.inject({
      method: "GET",
      url: `/api/topics/${topic.id}/material-questions`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(questionsRes.statusCode).toBe(200);
    const questions = questionsRes.json() as {
      id: string;
      reviewStatus: string;
      repairFlags: string[];
      repairActions: { type: string }[];
      rawCandidate: { question: string };
    }[];
    expect(questions).toHaveLength(1);
    expect(questions[0].reviewStatus).toBe("needs_repair");
    expect(questions[0].repairFlags).toContain("missing_or_extra_options");
    expect(questions[0].repairActions[0]?.type).toBe("recover_options_from_source_context");
    expect(questions[0].rawCandidate.question).toContain("Mineral rights");

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/topics/${topic.id}/material-questions/${questions[0].id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        convertToContentKind: "context",
      },
    });
    expect(patchRes.statusCode).toBe(200);
    expect((patchRes.json() as { active: boolean; reviewStatus: string }).active).toBe(false);

    const convertedChunks = await db
      .select()
      .from(materialTextChunks)
      .where(eq(materialTextChunks.topicId, topic.id));
    expect(convertedChunks.some((chunk) => chunk.kind === "context" && chunk.content.includes("Mineral rights"))).toBe(true);

    const [persistedQuestion] = await db
      .select()
      .from(materialQuestions)
      .where(eq(materialQuestions.topicId, topic.id))
      .limit(1);
    expect(persistedQuestion.reviewStatus).toBe("unresolved");
    expect(persistedQuestion.active).toBe(false);

    await app.close();
  });

  it("lets a user repair a malformed material question into the usable bank", async () => {
    const email = `repair-save-${Date.now()}@example.com`;
    const { user, token } = await registerUser(email);
    const topic = await createTopic(user.id, "Repair save topic");
    const app = await build();

    const boundary = "----aiquizrepairsaveboundary";
    const content = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="files"; filename="repair-save.txt"',
      "Content-Type: text/plain",
      "",
      `Chapter 1: Property
Chapter Quiz
1. Mineral rights associated with real property are always:
B. separable and divisible
C. sold separately from the property
D. an interest in personal property
Answer Key
1. A. Mineral rights are an interest in real property.`,
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const uploadRes = await app.inject({
      method: "POST",
      url: `/api/topics/${topic.id}/material-imports`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: content,
    });

    expect(uploadRes.statusCode).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const [needsRepair] = await db
      .select()
      .from(materialQuestions)
      .where(eq(materialQuestions.topicId, topic.id))
      .limit(1);
    expect(needsRepair.reviewStatus).toBe("needs_repair");

    const repairRes = await app.inject({
      method: "PATCH",
      url: `/api/topics/${topic.id}/material-questions/${needsRepair.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        options: [
          { id: "A", text: "an interest in real property" },
          { id: "B", text: "separable and divisible" },
          { id: "C", text: "sold separately from the property" },
          { id: "D", text: "an interest in personal property" },
        ],
        correctAnswers: [0],
        reviewStatus: "auto_repaired",
        active: true,
      },
    });

    expect(repairRes.statusCode).toBe(200);
    const repaired = repairRes.json() as { reviewStatus: string; correctAnswers: number[]; active: boolean };
    expect(repaired.reviewStatus).toBe("auto_repaired");
    expect(repaired.correctAnswers).toEqual([0]);
    expect(repaired.active).toBe(true);

    const [job] = await db
      .select()
      .from(materialImportJobs)
      .where(eq(materialImportJobs.id, needsRepair.jobId))
      .limit(1);
    expect(job.summary).toMatchObject({
      needsRepairCount: 0,
      autoRepairedCount: 1,
      repairDebtRate: 0,
    });

    await app.close();
  });
});
