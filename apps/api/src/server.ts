import "./env.js";
import { z } from "zod";
import { build } from "./app.js";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_BASE_URL: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  BRAVE_API_KEY: z.string().optional(),
  PORT: z.coerce.number().default(3001),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Missing required environment variables:");
  for (const [key, errors] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(`  ${key}: ${errors?.join(", ")}`);
  }
  process.exit(1);
}

const env = parsed.data;

async function main() {
  const app = await build();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
