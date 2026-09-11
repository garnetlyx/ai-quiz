import "../env.js";
import { readFile } from "fs/promises";
import path from "path";
import { client } from "../db/index.js";
import { importMaterialQuestions } from "../services/materialImport.js";
import type { MaterialQuestion } from "../services/materialExtraction.js";

function repoRoot(): string {
  return path.resolve(process.cwd(), "../..");
}

function getArg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

async function main() {
  const input = getArg("input") || "data/wa-agent/material-questions.json";
  const topicId = getArg("topic-id");
  const replaceExisting = getArg("replace-existing") === "true";
  const buildScope = getArg("build-scope") === "true";

  if (!topicId) throw new Error("--topic-id=<uuid> is required");

  const inputPath = path.resolve(repoRoot(), input);
  const questions = JSON.parse(await readFile(inputPath, "utf8")) as MaterialQuestion[];
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error(`No questions found in ${inputPath}`);
  }

  const result = await importMaterialQuestions({
    topicId,
    questions,
    replaceExisting,
    buildScope,
    fileName: path.basename(inputPath),
  });

  console.log(JSON.stringify({ input: inputPath, ...result }, null, 2));
}

main()
  .then(() => client.end())
  .catch(async (error) => {
    console.error(error);
    await client.end();
    process.exitCode = 1;
  });
