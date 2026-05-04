import Fastify from "fastify";
import cors from "@fastify/cors";
import authPlugin from "./plugins/auth.js";
import { authRoutes } from "./routes/auth.js";
import { topicRoutes } from "./routes/topics.js";
import { quizRoutes } from "./routes/quiz.js";
import { historyRoutes } from "./routes/history.js";

export async function build() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(authPlugin);

  app.get("/api/health", async () => ({ status: "ok" }));

  await app.register(authRoutes);
  await app.register(topicRoutes);
  await app.register(quizRoutes);
  await app.register(historyRoutes);

  return app;
}
