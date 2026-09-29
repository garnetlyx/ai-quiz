import "../env.js";
import { execFile } from "child_process";
import { existsSync } from "fs";
import { readFile, rename, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { eq } from "drizzle-orm";
import { client, db } from "../db/index.js";
import { topics } from "../db/schema.js";
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

// Runs the user-chosen model CLI with the prompt as its final argument. Runs in
// the OS temp dir so an agent-style CLI never sees or touches the repo.
function runModel(command: string, prompt: string, timeoutMs: number): Promise<string> {
  const [bin, ...args] = command.split(/\s+/).filter(Boolean);
  return new Promise((resolve, reject) => {
    const child = execFile(bin, [...args, prompt], { cwd: os.tmpdir(), timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
    // Agent CLIs in print mode read stdin until EOF when it is not a TTY; close it.
    child.stdin?.end();
  });
}

const LETTERS = new Set(["A", "B", "C", "D"]);

function parseVerdicts(stdout: string, count: number): MaterialAuditVerdict[] {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("no JSON array in model output");
  const parsed = JSON.parse(stdout.slice(start, end + 1)) as Record<string, unknown>[];
  if (!Array.isArray(parsed) || parsed.length !== count) {
    throw new Error(`expected ${count} verdicts, got ${Array.isArray(parsed) ? parsed.length : "non-array"}`);
  }
  return parsed.map((raw, index) => {
    if (raw.n !== index + 1) throw new Error(`verdict ${index + 1} has n=${String(raw.n)}`);
    if (typeof raw.complete !== "boolean" || typeof raw.optionsClean !== "boolean") {
      throw new Error(`verdict ${index + 1} missing complete/optionsClean`);
    }
    if (!["correct", "wrong", "unsure"].includes(raw.keyVerdict as string)) {
      throw new Error(`verdict ${index + 1} has keyVerdict=${String(raw.keyVerdict)}`);
    }
    return {
      complete: raw.complete,
      optionsClean: raw.optionsClean,
      modelAnswer: LETTERS.has(raw.modelAnswer as string) ? (raw.modelAnswer as MaterialAuditVerdict["modelAnswer"]) : null,
      keyVerdict: raw.keyVerdict as MaterialAuditVerdict["keyVerdict"],
      explanationMatches: typeof raw.explanationMatches === "boolean" ? raw.explanationMatches : null,
      issues: Array.isArray(raw.issues) ? raw.issues.map(String) : [],
    };
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
  const topicId = getArg("topic-id");
  if (!topicId) throw new Error("Pass --topic-id=<uuid> (its title and description frame the audit)");
  const inputPath = path.resolve(repoRoot(), getArg("input") || DEFAULT_INPUT);
  const outputPath = path.resolve(repoRoot(), getArg("output") || DEFAULT_OUTPUT);
  const batchSize = Number(getArg("batch-size") || 10);
  const concurrency = Number(getArg("concurrency") || 1);
  const limit = getArg("limit") ? Number(getArg("limit")) : Infinity;
  const timeoutMs = Number(getArg("timeout-ms") || 600000);

  const [topic] = await db.select().from(topics).where(eq(topics.id, topicId)).limit(1);
  await client.end();
  if (!topic) throw new Error(`Topic ${topicId} not found`);
  const topicDescription = `${topic.title}. ${topic.description}`;

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

  const save = async () => {
    const tmp = `${outputPath}.tmp`;
    await writeFile(tmp, `${JSON.stringify([...cache.values()], null, 2)}\n`);
    await rename(tmp, outputPath);
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
          verdicts = parseVerdicts(stdout, batch.length);
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
      batch.forEach((question, i) => {
        const fingerprint = materialAuditFingerprint(question);
        cache.set(fingerprint, { fingerprint, promptVersion: MATERIAL_AUDIT_PROMPT_VERSION, command, auditedAt, verdict: verdicts![i] });
      });
      done += batch.length;
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
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
