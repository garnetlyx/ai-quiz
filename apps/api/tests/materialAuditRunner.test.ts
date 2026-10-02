import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { materialQuestionFixture } from "./helpers/materialQuestion.js";
import { materialAuditFingerprint, type MaterialAuditRecord } from "../src/services/materialBank.js";
import { MATERIAL_AUDIT_PROMPT_VERSION } from "../src/prompts/material-audit.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function setup(count = 1) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "material-audit-test-"));
  temporaryDirectories.push(directory);
  const input = path.join(directory, "questions.json");
  const output = path.join(directory, "audit.json");
  const model = path.join(directory, "model.cjs");
  const questions = Array.from({ length: count }, (_, index) => materialQuestionFixture({
    id: String(index), question: `Question ${index}: which right applies to rivers?`,
  }));
  await writeFile(input, JSON.stringify(questions));
  await writeFile(model, `
const prompt = process.argv.at(-1);
if (!prompt.includes('Offline topic context')) process.exit(3);
const items = JSON.parse(prompt.split('ITEMS:\\n')[1]);
if (process.env.FAKE_MODEL_FAILURE && items.some(item => item.question.startsWith('Question 0:'))) process.exit(7);
const answered = process.env.FAKE_MODEL_TRUNCATE ? items.slice(0, 1) : items;
console.log(JSON.stringify(answered.map(item => ({ n: item.n, complete: true, optionsClean: true, modelAnswer: 'B', keyVerdict: 'correct', explanationMatches: true, issues: [] }))));
`);
  const command = `${process.execPath} ${model}`;
  const run = async (extraArgs: string[] = [], failure = false, truncate = false) => {
    try {
      const result = await execFileAsync(process.execPath, [
        "--import", "tsx", "src/scripts/audit-material-bank.ts",
        `--input=${input}`, `--output=${output}`, `--cmd=${command}`,
        "--topic-description=Offline topic context", "--batch-size=1", ...extraArgs,
      ], {
        cwd: path.resolve(import.meta.dirname, ".."),
        env: { ...process.env, DATABASE_URL: "postgres://invalid:invalid@127.0.0.1:1/invalid", FAKE_MODEL_FAILURE: failure ? "1" : "", FAKE_MODEL_TRUNCATE: truncate ? "1" : "" },
        timeout: 20_000,
      });
      return { ...result, code: 0 };
    } catch (error) {
      const result = error as Error & { code: number; stdout: string; stderr: string };
      return { stdout: result.stdout, stderr: result.stderr, code: result.code };
    }
  };
  return { directory, output, questions, command, run };
}

describe("material audit runner", () => {
  it("audits an exported bank without a database and retains the command/cache contract", async () => {
    const { run, output, questions, command } = await setup();
    const result = await run();
    expect(result.stderr).not.toContain("ECONNREFUSED");
    expect(result.code, result.stderr).toBe(0);
    const records = JSON.parse(await readFile(output, "utf8")) as MaterialAuditRecord[];
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ fingerprint: materialAuditFingerprint(questions[0]), command, promptVersion: MATERIAL_AUDIT_PROMPT_VERSION });
  });

  it("exits nonzero for exhausted batches while saving successes for a resumable run", async () => {
    const { run, output } = await setup(3);
    const failed = await run(["--concurrency=2"], true);
    expect(failed.stdout).toContain('"failedThisRun": 1');
    expect(failed.code).toBe(1);
    expect(JSON.parse(await readFile(output, "utf8"))).toHaveLength(2);
    const resumed = await run(["--concurrency=2"]);
    expect(resumed.code, resumed.stderr).toBe(0);
    expect(resumed.stdout).toContain('"auditedThisRun": 1');
    expect(JSON.parse(await readFile(output, "utf8"))).toHaveLength(3);
  });

  it("keeps the verdicts a truncated answer did contain and asks again only for the rest", async () => {
    const { run, output } = await setup(4);
    const result = await run(["--batch-size=4", "--concurrency=1"], false, true);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('"failedThisRun": 0');
    expect(JSON.parse(await readFile(output, "utf8"))).toHaveLength(4);
  });

  it("persists every concurrent batch and leaves no temporary cache files", async () => {
    const { run, output, directory } = await setup(24);
    const result = await run(["--concurrency=8"]);
    expect(result.code, result.stderr).toBe(0);
    const records = JSON.parse(await readFile(output, "utf8")) as MaterialAuditRecord[];
    expect(new Set(records.map((record) => record.fingerprint)).size).toBe(24);
    expect((await readdir(directory)).filter((file) => file.endsWith(".tmp"))).toEqual([]);
  });

  it("rejects invalid worker counts instead of reporting success without doing work", async () => {
    const { run } = await setup();
    const result = await run(["--concurrency=not-a-number"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("concurrency must be a positive integer");
  });
});
