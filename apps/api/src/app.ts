import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import authPlugin from "./plugins/auth.js";
import { authRoutes } from "./routes/auth.js";
import { topicRoutes } from "./routes/topics.js";
import { quizRoutes } from "./routes/quiz.js";
import { historyRoutes } from "./routes/history.js";
import { startMaterialImportWorker } from "./services/materialImport.js";

export async function build() {
  const maxMaterialUploadBytes = Number(process.env.MATERIAL_MAX_UPLOAD_MB || 100) * 1024 * 1024;
  const app = Fastify({ logger: true, bodyLimit: maxMaterialUploadBytes });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        message: "Validation error",
        details: error.issues,
      });
    }
    reply.send(error);
  });

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true,
  });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
  });
  await app.register(multipart, {
    limits: {
      fileSize: maxMaterialUploadBytes,
      files: 10,
    },
  });
  await app.register(authPlugin);
  startMaterialImportWorker();

  app.get("/api/health", async () => ({ status: "ok" }));

  await app.register(authRoutes);
  await app.register(topicRoutes);
  await app.register(quizRoutes);
  await app.register(historyRoutes);

  return app;
}
