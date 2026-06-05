import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export const nativeFetch = globalThis.fetch;

function findEnvFile(startDir: string): string | null {
  let current = startDir;

  while (true) {
    const candidate = join(current, ".env");
    if (existsSync(candidate)) return candidate;

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const envFile = findEnvFile(process.cwd()) ?? findEnvFile(currentDir);

if (envFile) {
  dotenv.config({ path: envFile });
}
