import "../env.js";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import {
  type AiSectionClassifier,
  extractMaterialQuestions,
} from "../services/materialExtraction.js";
import { extractPdfLayoutText } from "../services/pdfLayoutText.js";
import { buildMaterialQuestionVerifier } from "../services/materialVerification.js";

const DEFAULT_INPUT_DIR = "data/wa-agent/text";
const DEFAULT_INPUT_FILE = "Wa-agent.txt";

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

function splitListArg(value: string | null): string[] {
  return value
    ? value.split(",").map((item) => item.trim()).filter(Boolean)
    : [];
}

async function readJsonFile<T>(filePath: string | null): Promise<T | null> {
  if (!filePath) return null;
  try {
    return JSON.parse(await readFile(resolveFromRoot(filePath), "utf8")) as T;
  } catch {
    return null;
  }
}

function parseJsonContent(content: string | null): unknown {
  if (!content) throw new Error("AI returned empty content");
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI response did not contain JSON");
    return JSON.parse(match[0]);
  }
}

function buildClassifier(): { classifier: AiSectionClassifier | null; model: string | null } {
  const baseURL = process.env.MATERIAL_AI_BASE_URL;
  const apiKey = process.env.MATERIAL_AI_API_KEY;
  const model = process.env.MATERIAL_AI_MODEL || null;

  if (!baseURL || !apiKey || !model) {
    return { classifier: null, model };
  }

  const cache = new Map<string, { kind: "description" | "questions" | "mixed"; confidence: number }>();
  const timeoutMs = Number(process.env.MATERIAL_AI_TIMEOUT_MS || 20000);

  return {
    model,
    classifier: {
      async classify(input) {
        const key = `${input.source}:${input.sectionTitle}:${input.text.slice(0, 400)}`;
        const cached = cache.get(key);
        if (cached) return cached;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(`${baseURL.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  "Classify OCR text chunks for exam prep ingestion. Return only JSON with kind: description|questions|mixed and confidence: 0..1.",
              },
              {
                role: "user",
                content: JSON.stringify(input),
              },
            ],
          }),
        }).finally(() => clearTimeout(timeout));
        if (!response.ok) {
          throw new Error(`AI classification failed with ${response.status}`);
        }
        const completion = await response.json() as {
          choices?: { message?: { content?: string | null } }[];
        };

        const parsed = parseJsonContent(completion.choices?.[0]?.message?.content || null) as {
          kind?: string;
          confidence?: number;
        };
        const result = {
          kind: parsed.kind === "description" || parsed.kind === "mixed" ? parsed.kind : "questions",
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
        } satisfies { kind: "description" | "questions" | "mixed"; confidence: number };
        cache.set(key, result);
        return result;
      },
    },
  };
}

async function main() {
  const input = getArg("input") || path.join(DEFAULT_INPUT_DIR, DEFAULT_INPUT_FILE);
  const inputPdfs = splitListArg(getArg("input-pdf"));
  const outputDir = getArg("output-dir") || DEFAULT_INPUT_DIR;
  const outputPath = resolveFromRoot(outputDir);
  const layoutTextFile = getArg("layout-text-file") || "material-layout-text.txt";
  const previousQuestionsFile = getArg("previous-questions");
  const inputPath = resolveFromRoot(input);
  const pdfLayouts = [];

  for (const inputPdf of inputPdfs) {
    pdfLayouts.push({
      inputPdf,
      layout: await extractPdfLayoutText(resolveFromRoot(inputPdf)),
    });
  }

  const hasPdfInput = pdfLayouts.length > 0;
  const text = hasPdfInput
    ? pdfLayouts.map(({ inputPdf, layout }) => `\n\n[PDF_SOURCE ${inputPdf}]\n${layout.text.trim()}`).join("\n")
    : await readFile(inputPath, "utf8");
  const sourceFile = hasPdfInput ? inputPdfs.join(",") : input;
  const { classifier, model } = buildClassifier();
  const verifier = process.env.MATERIAL_AI_VERIFY === "false" ? null : buildMaterialQuestionVerifier();

  const result = await extractMaterialQuestions({
    filePath: sourceFile,
    text,
    classifier,
    verifier,
    aiModel: model || process.env.MATERIAL_AI_MODEL || process.env.OPENAI_MODEL || null,
    aiSectionLimit: Number(process.env.MATERIAL_AI_SECTION_LIMIT || 3),
  });

  await mkdir(outputPath, { recursive: true });
  if (hasPdfInput) {
    const diagnostics = {
      sources: pdfLayouts.map(({ inputPdf, layout }) => ({
        inputPdf,
        ...layout.diagnostics,
      })),
      totals: pdfLayouts.reduce(
        (total, item) => ({
          pages: total.pages + item.layout.diagnostics.pages,
          twoColumnBands: total.twoColumnBands + item.layout.diagnostics.twoColumnBands,
          singleColumnBands: total.singleColumnBands + item.layout.diagnostics.singleColumnBands,
          ambiguousLines: total.ambiguousLines + item.layout.diagnostics.ambiguousLines,
        }),
        { pages: 0, twoColumnBands: 0, singleColumnBands: 0, ambiguousLines: 0 }
      ),
    };
    await writeFile(
      path.join(outputPath, layoutTextFile),
      `${text.trim()}\n`
    );
    await writeFile(
      path.join(outputPath, "material-layout-report.json"),
      `${JSON.stringify(diagnostics, null, 2)}\n`
    );
  }
  await writeFile(
    path.join(outputPath, "material-questions.json"),
    `${JSON.stringify(result.questions, null, 2)}\n`
  );
  await writeFile(
    path.join(outputPath, "material-extraction-report.json"),
    `${JSON.stringify(result.report, null, 2)}\n`
  );
  await writeFile(
    path.join(outputPath, "material-review-items.json"),
    `${JSON.stringify(result.reviewItems, null, 2)}\n`
  );

  const previousQuestions = await readJsonFile<{
    id: string;
    contentHash: string;
    reviewStatus: string;
    question: string;
    source: string;
    sourceLocation?: { lineStart?: number; lineEnd?: number; sectionTitle?: string | null };
  }[]>(previousQuestionsFile);
  if (previousQuestions) {
    const currentByHash = new Map(result.questions.map((question) => [question.contentHash, question]));
    const diagnostics = previousQuestions
      .filter((question) => question.reviewStatus === "rejected")
      .map((previous) => {
        const current = currentByHash.get(previous.contentHash);
        return {
          previousId: previous.id,
          contentHash: previous.contentHash,
          source: previous.source,
          previousStatus: previous.reviewStatus,
          currentStatus: current?.reviewStatus || "not_matched",
          repairFlags: current?.repairFlags || [],
          repairActions: current?.repairActions || [],
          sourceLocation: current?.sourceLocation || previous.sourceLocation || null,
          questionPreview: current?.question || previous.question,
        };
      });
    await writeFile(
      path.join(outputPath, "material-repair-diagnostics.json"),
      `${JSON.stringify(diagnostics, null, 2)}\n`
    );
  }

  if (hasPdfInput) {
    const layoutReport = JSON.parse(
      await readFile(path.join(outputPath, "material-layout-report.json"), "utf8")
    ) as unknown;
    console.log(JSON.stringify({ layout: layoutReport }, null, 2));
  }
  console.log(JSON.stringify(result.report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
