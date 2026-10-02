import "../env.js";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { readFile, rename, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import {
  buildMaterialAuditPrompt,
  MATERIAL_AUDIT_PROMPT_VERSION,
  type MaterialAuditItem,
} from "../prompts/material-audit.js";
import {
  isServableMaterialQuestion,
  materialAuditFingerprint,
  type MaterialAuditRecord,
  type MaterialAuditVerdict,
} from "../services/materialBank.js";
import { parseAuditVerdicts } from "../services/materialAuditParse.js";
import type { MaterialQuestion } from "../services/materialExtraction.js";

const DEFAULT_INPUT = "data/wa-agent/export/material-questions.json";
const DEFAULT_OUTPUT = "data/wa-agent/export/model-audit.json";

function repoRoot(): string {
  return path.resolve(process.cwd(), "../..");
}

function getArg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function positiveIntegerArg(name: string, defaultValue: number): number {
  const raw = getArg(name);
  if (raw === null) return defaultValue;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

async function resolveTopicDescription(): Promise<string> {
  const description = getArg("topic-description");
  if (description?.trim()) return description;
  const topicId = getArg("topic-id");
  if (!topicId) throw new Error("Pass --topic-id=<uuid> or --topic-description=<title and description>");
  // Exported banks can be audited independently of database availability.
  const { client, db } = await import("../db/index.js");
  try {
    const { eq } = await import("drizzle-orm");
    const { topics } = await import("../db/schema.js");
    const [topic] = await db.select().from(topics).where(eq(topics.id, topicId)).limit(1);
    if (!topic) throw new Error(`Topic ${topicId} not found`);
    return `${topic.title}. ${topic.description}`;
  } finally {
    await client.end();
  }
}

// Runs the user-chosen model CLI with the prompt as its final argument. Runs in
// the OS temp dir so an agent-style CLI never sees or touches the repo. The CLI
// may be a wrapper that spawns the real process, so it runs in its own process
// group and the whole group is killed on timeout.
function runModel(command: string, prompt: string, timeoutMs: number): Promise<string> {
  const [bin, ...args] = command.split(/\s+/).filter(Boolean);
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [...args, prompt], { cwd: os.tmpdir(), detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.resume();
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        // group already gone
      }
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`model CLI timed out after ${timeoutMs}ms`));
      else if (code !== 0) reject(new Error(`model CLI exited with code ${code}`));
      else resolve(stdout);
    });
  });
}

function toAuditItem(question: MaterialQuestion, n: number): MaterialAuditItem {
  return {
    n,
    question: question.question,
    options: Object.fromEntries(question.options.map((option) => [option.id, option.text])),
    keyedAnswer: question.answerLabels.join(","),
    explanation: question.answerExplanation || null,
  };
}

// Audits every servable question in the bank with an external model CLI and
// caches verdicts by fingerprint, so reruns only audit new or changed records.
async function main() {
  const command = getArg("cmd") || process.env.MATERIAL_AUDIT_CMD;
  if (!command) throw new Error("Pass --cmd=\"<cli> <args> -p\" or set MATERIAL_AUDIT_CMD");
  const inputPath = path.resolve(repoRoot(), getArg("input") || DEFAULT_INPUT);
  const outputPath = path.resolve(repoRoot(), getArg("output") || DEFAULT_OUTPUT);
  const batchSize = positiveIntegerArg("batch-size", 10);
  const concurrency = positiveIntegerArg("concurrency", 1);
  const limit = positiveIntegerArg("limit", Infinity);
  const timeoutMs = positiveIntegerArg("timeout-ms", 600000);
  const topicDescription = await resolveTopicDescription();

  const questions = JSON.parse(await readFile(inputPath, "utf8")) as MaterialQuestion[];
  const cache = new Map<string, MaterialAuditRecord>();
  if (existsSync(outputPath)) {
    for (const record of JSON.parse(await readFile(outputPath, "utf8")) as MaterialAuditRecord[]) {
      cache.set(record.fingerprint, record);
    }
  }

  const pending = questions
    .filter(isServableMaterialQuestion)
    .filter((question) => cache.get(materialAuditFingerprint(question))?.promptVersion !== MATERIAL_AUDIT_PROMPT_VERSION)
    .slice(0, limit);
  const batches: MaterialQuestion[][] = [];
  for (let i = 0; i < pending.length; i += batchSize) batches.push(pending.slice(i, i + batchSize));
  console.error(`[audit] ${pending.length} to audit in ${batches.length} batches (${cache.size} cached), concurrency ${concurrency}`);

  let saving = Promise.resolve();
  const save = () => {
    // Serialize snapshots and renames so an older worker cannot overwrite a
    // newer cache or rename another worker's temporary file.
    saving = saving.then(async () => {
      const tmp = `${outputPath}.${randomUUID()}.tmp`;
      try {
        await writeFile(tmp, `${JSON.stringify([...cache.values()], null, 2)}\n`);
        await rename(tmp, outputPath);
      } finally {
        await rm(tmp, { force: true });
      }
    });
    return saving;
  };

  let done = 0;
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      const prompt = buildMaterialAuditPrompt(topicDescription, batch.map((question, i) => toAuditItem(question, i + 1)));
      let verdicts: MaterialAuditVerdict[] | null = null;
      for (let attempt = 1; attempt <= 2 && !verdicts; attempt++) {
        let stdout = "";
        try {
          stdout = await runModel(command, prompt, timeoutMs);
          verdicts = parseAuditVerdicts(stdout, batch.length);
        } catch (error) {
          const rawPath = path.join(os.tmpdir(), `material-audit-failed-${Date.now()}.txt`);
          if (stdout) await writeFile(rawPath, stdout);
          console.error(`[audit] batch attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)}${stdout ? ` (raw: ${rawPath})` : ""}`);
        }
      }
      if (!verdicts) {
        failed += batch.length;
        continue;
      }
      const auditedAt = new Date().toISOString();
      verdicts.forEach((verdict, i) => {
        const fingerprint = materialAuditFingerprint(batch[i]);
        cache.set(fingerprint, { fingerprint, promptVersion: MATERIAL_AUDIT_PROMPT_VERSION, command, auditedAt, verdict });
      });
      done += verdicts.length;
      // The model sometimes stops mid-array; the verdicts it did finish are kept
      // and only the rest is asked again.
      if (verdicts.length < batch.length) batches.push(batch.slice(verdicts.length));
      await save();
      console.error(`[audit] ${done}/${pending.length} audited, ${failed} failed`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  const verdicts = [...cache.values()].map((record) => record.verdict);
  console.log(JSON.stringify({
    promptVersion: MATERIAL_AUDIT_PROMPT_VERSION,
    auditedThisRun: done,
    failedThisRun: failed,
    totalCached: cache.size,
    incomplete: verdicts.filter((v) => !v.complete).length,
    optionsBroken: verdicts.filter((v) => !v.optionsClean).length,
    keyWrong: verdicts.filter((v) => v.keyVerdict === "wrong").length,
    keyUnsure: verdicts.filter((v) => v.keyVerdict === "unsure").length,
    explanationMismatch: verdicts.filter((v) => v.explanationMatches === false).length,
  }, null, 2));
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
