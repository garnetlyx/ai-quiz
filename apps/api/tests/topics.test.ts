import "../src/env.js";
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { build } from "../src/app.js";
import { db } from "../src/db/index.js";
import { topics, users } from "../src/db/schema.js";

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
      materials: { examples: "", additionalTopics: "", notes: "" },
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
