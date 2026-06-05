import { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { isValidAgent, AI_AGENT_OPTIONS, type AiAgent } from "../services/ai.js";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const aiAgentSchema = z.object({ agent: z.enum(["glm", "deepseek", "qwen"]) });

export async function authRoutes(app: FastifyInstance) {
  app.post(
    "/api/auth/register",
    {
      config: {
        rateLimit: { max: 5, timeWindow: "1 minute" },
      },
    },
    async (request, reply) => {
      const parsed = registerSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          message: "Validation failed",
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      const { email, password } = parsed.data;

      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existing.length > 0) {
        return reply.status(409).send({ message: "Email already registered" });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const [user] = await db
        .insert(users)
        .values({ email, passwordHash })
        .returning({ id: users.id, email: users.email });

      const token = app.jwt.sign({ userId: user.id });
      return reply.status(201).send({ user, token });
    },
  );

  app.post(
    "/api/auth/login",
    {
      config: {
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
    },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          message: "Validation failed",
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      const { email, password } = parsed.data;

      const rows = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (rows.length === 0) {
        return reply.status(401).send({ message: "Invalid credentials" });
      }

      const user = rows[0];
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return reply.status(401).send({ message: "Invalid credentials" });
      }

      const token = app.jwt.sign({ userId: user.id });
      return reply.send({
        user: { id: user.id, email: user.email, aiAgent: user.aiAgent },
        token,
      });
    },
  );

  app.get("/api/auth/ai-agent", async (request, reply) => {
    await (app as any).authenticate(request);
    const userId = (request.user as { userId: string }).userId;
    const [row] = await db.select({ aiAgent: users.aiAgent }).from(users).where(eq(users.id, userId)).limit(1);
    if (!row) return reply.status(404).send({ message: "User not found" });
    return reply.send({
      agent: row.aiAgent && isValidAgent(row.aiAgent) ? row.aiAgent : "glm",
      options: AI_AGENT_OPTIONS,
    });
  });

  app.put("/api/auth/ai-agent", async (request, reply) => {
    await (app as any).authenticate(request);
    const parsed = aiAgentSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: "Invalid agent" });

    const userId = (request.user as { userId: string }).userId;
    await db.update(users).set({ aiAgent: parsed.data.agent }).where(eq(users.id, userId));
    return reply.send({ agent: parsed.data.agent });
  });
}
