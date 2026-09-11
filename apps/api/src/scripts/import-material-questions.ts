import "../env.js";
import { readFile } from "fs/promises";
import path from "path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { client, db } from "../db/index.js";
import { materialImportJobs, materialQuestions, topics } from "../db/schema.js";
import { persistQuestion, refreshMaterialImportSummary } from "../services/materialImport.js";
import { normalizeScope } from "../services/scope.js";
import type { MaterialQuestion } from "../services/materialExtraction.js";

function repoRoot(): string {
  return path.resolve(process.cwd(), "../..");
}

function resolveFromRoot(value: string): string {
  return path.resolve(repoRoot(), value);
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

  if (!topicId) throw new Error("--topic-id=<uuid> is required");

  const [topic] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.id, topicId), isNull(topics.archivedAt)))
    .limit(1);
  if (!topic) throw new Error(`Topic ${topicId} not found (or archived)`);

  const inputPath = resolveFromRoot(input);
  const questions = JSON.parse(await readFile(inputPath, "utf8")) as MaterialQuestion[];
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error(`No questions found in ${inputPath}`);
  }

  const [job] = await db
    .insert(materialImportJobs)
    .values({
      topicId: topic.id,
      userId: topic.userId,
      fileName: path.basename(inputPath),
      filePath: inputPath,
      mimeType: "application/json",
      status: "processing",
      progress: 10,
      summary: {},
    })
    .returning();

  let deactivatedCount = 0;
  let removedCollisionCount = 0;
  if (replaceExisting) {
    const deactivated = await db
      .update(materialQuestions)
      .set({ active: false })
      .where(and(eq(materialQuestions.topicId, topic.id), eq(materialQuestions.active, true)))
      .returning({ id: materialQuestions.id });
    deactivatedCount = deactivated.length;

    // Rows whose hash collides with the incoming set would silently block the
    // fresh inserts via the (topic_id, content_hash) unique index; retire them.
    const incomingHashes = questions
      .map((question) => question.contentHash)
      .filter(Boolean) as string[];
    const removed = await db
      .delete(materialQuestions)
      .where(and(eq(materialQuestions.topicId, topic.id), inArray(materialQuestions.contentHash, incomingHashes)))
      .returning({ id: materialQuestions.id });
    removedCollisionCount = removed.length;

    await db
      .update(materialImportJobs)
      .set({ progress: 30, updatedAt: new Date() })
      .where(eq(materialImportJobs.id, job.id));
  }

  const scope = normalizeScope(topic.scope);
  let insertedCount = 0;
  for (const question of questions) {
    const inserted = await persistQuestion(job.id, topic.id, question, scope);
    if (inserted) insertedCount += 1;
  }
  const skippedCount = questions.length - insertedCount;

  await refreshMaterialImportSummary(job.id);
  await db
    .update(materialImportJobs)
    .set({ status: "completed", progress: 100, updatedAt: new Date(), completedAt: new Date() })
    .where(eq(materialImportJobs.id, job.id));

  console.log(JSON.stringify({
    topicId: topic.id,
    jobId: job.id,
    input: inputPath,
    totalInFile: questions.length,
    inserted: insertedCount,
    skippedDuplicate: skippedCount,
    deactivatedExisting: deactivatedCount,
    removedHashCollisions: removedCollisionCount,
  }, null, 2));
}

main()
  .then(() => client.end())
  .catch(async (error) => {
    console.error(error);
    await client.end();
    process.exitCode = 1;
  });
