import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import { FastifyInstance, FastifyRequest } from "fastify";

async function authPlugin(app: FastifyInstance) {
  await app.register(jwt, {
    secret: process.env.JWT_SECRET || "dev-secret-change-me",
  });

  app.decorate("authenticate", async function (request: FastifyRequest) {
    try {
      await request.jwtVerify();
    } catch {
      const err = new Error("Authentication required") as Error & {
        statusCode: number;
      };
      err.statusCode = 401;
      throw err;
    }
  });
}

export default fp(authPlugin);

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
}
