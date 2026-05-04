import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";

let current = process.cwd();
while (true) {
  const candidate = join(current, ".env");
  if (existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }

  const parent = dirname(current);
  if (parent === current) break;
  current = parent;
}

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
