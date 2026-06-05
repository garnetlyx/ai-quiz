import "../src/env.js";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { build } from "../src/app.js";
import { db } from "../src/db/index.js";
import { users } from "../src/db/schema.js";

const testEmails: string[] = [];

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

afterAll(async () => {
  if (testEmails.length === 0) return;
  for (const email of testEmails) {
    await db.delete(users).where(eq(users.email, email));
  }
});

describe("auth routes", () => {
  it("registers a new user", async () => {
    const email = uniqueEmail("register-success");
    const app = await build();

    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { email, password: "password123" },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as { user: { id: string; email: string }; token: string };
      expect(body.user.id).toBeTruthy();
      expect(body.user.email).toBe(email);
      expect(body.token).toEqual(expect.any(String));
      expect(body.token.length).toBeGreaterThan(0);

      testEmails.push(email);
    } finally {
      await app.close();
    }
  });

  it("rejects duplicate registration email", async () => {
    const email = uniqueEmail("register-duplicate");
    const app = await build();

    try {
      const firstRes = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { email, password: "password123" },
      });
      expect(firstRes.statusCode).toBe(201);
      testEmails.push(email);

      const secondRes = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { email, password: "password123" },
      });
      expect(secondRes.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });

  it("rejects invalid registration payload", async () => {
    const app = await build();

    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { email: uniqueEmail("register-invalid") },
      });

      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("logs in with valid credentials", async () => {
    const email = uniqueEmail("login-success");
    const app = await build();

    try {
      const registerRes = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { email, password: "password123" },
      });
      expect(registerRes.statusCode).toBe(201);
      testEmails.push(email);

      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password: "password123" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { user: { id: string; email: string }; token: string };
      expect(body.user.id).toBeTruthy();
      expect(body.user.email).toBe(email);
      expect(body.token).toEqual(expect.any(String));
      expect(body.token.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("rejects login with wrong password", async () => {
    const email = uniqueEmail("login-wrong-password");
    const app = await build();

    try {
      const registerRes = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { email, password: "password123" },
      });
      expect(registerRes.statusCode).toBe(201);
      testEmails.push(email);

      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password: "wrong-password" },
      });

      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("rejects login for nonexistent user", async () => {
    const app = await build();

    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: uniqueEmail("login-nonexistent"), password: "password123" },
      });

      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("rejects invalid login payload", async () => {
    const app = await build();

    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: uniqueEmail("login-invalid") },
      });

      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("rejects protected topics route without token", async () => {
    const app = await build();

    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/topics",
      });

      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("rate limits registration after exceeding limit", async () => {
    const app = await build();

    try {
      // Register up to the limit (5/min), then expect 429 on the next attempt
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/api/auth/register",
          payload: { email: uniqueEmail(`ratelimit-${i}`), password: "password123" },
        });
        testEmails.push(uniqueEmail(`ratelimit-${i}`));
        expect(res.statusCode).toBe(201);
      }

      // 6th request should be rate limited
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { email: uniqueEmail("ratelimit-exceeded"), password: "password123" },
      });
      testEmails.push(uniqueEmail("ratelimit-exceeded"));
      expect(res.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });
});
