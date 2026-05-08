import OpenAI from "openai";
import type { MaterialQuestionVerifier } from "./materialExtraction.js";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || "dummy",
      baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    });
  }
  return client;
}

function getModel(): string {
  return process.env.MATERIAL_AI_MODEL || process.env.OPENAI_MODEL || "gpt-4o";
}

function parseJsonObject(content: string | null): unknown {
  if (!content) throw new Error("AI returned empty content");
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI response was not valid JSON");
    return JSON.parse(match[0]);
  }
}

function answerLabels(value: unknown): ("A" | "B" | "C" | "D")[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is "A" | "B" | "C" | "D" =>
    item === "A" || item === "B" || item === "C" || item === "D"
  );
}

export function buildMaterialQuestionVerifier(): MaterialQuestionVerifier | null {
  if (!process.env.OPENAI_API_KEY && !process.env.MATERIAL_AI_API_KEY) return null;
  const timeoutMs = Number(process.env.MATERIAL_AI_TIMEOUT_MS || 30000);

  return {
    async verify(input) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const response = await getClient().chat.completions.create(
        {
          model: getModel(),
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You verify OCR-extracted exam questions. Return only JSON: {answerLabels:string[], explanation:string, confidence:number}. Use the given question, options, and nearby source text. If the OCR is structurally corrupt or the answer cannot be determined, return empty answerLabels and confidence below 0.5.",
            },
            {
              role: "user",
              content: JSON.stringify(input),
            },
          ],
        },
        { signal: controller.signal }
      ).finally(() => clearTimeout(timeout));
      const content = response.choices[0]?.message?.content || null;
      const parsed = parseJsonObject(content) as {
        answerLabels?: unknown;
        explanation?: unknown;
        confidence?: unknown;
      };
      return {
        answerLabels: answerLabels(parsed.answerLabels),
        explanation: typeof parsed.explanation === "string" ? parsed.explanation : "",
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      };
    },
  };
}
