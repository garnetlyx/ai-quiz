import OpenAI from "openai";
import { z } from "zod";
import { nativeFetch } from "../env.js";
import { buildTopicInterpretMessages } from "../prompts/topic-interpret.js";
import { buildFormatDetectMessages } from "../prompts/format-detect.js";
import { buildQuestionGenerateMessages } from "../prompts/question-generate.js";
import { buildScopeGenerateMessages } from "../prompts/scope-generate.js";

const topicInterpretResultSchema: z.ZodType<
  TopicInterpretResult,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    needsClarification: z.boolean(),
    clarification: z.string().nullable().optional(),
    suggestedTopics: z.array(z.string()).nullable().optional(),
    interpretation: z
      .object({
        title: z.string(),
        description: z.string(),
      })
      .nullable()
      .optional(),
  })
  .transform(({ clarification, suggestedTopics, interpretation, ...result }) => ({
    ...result,
    ...(clarification != null ? { clarification } : {}),
    ...(suggestedTopics != null ? { suggestedTopics } : {}),
    ...(interpretation != null ? { interpretation } : {}),
  }));

const examFormatResultSchema = z.object({
  choicesCount: z.number().int().min(2).max(10),
  isMultiSelect: z.boolean(),
  rationale: z.string(),
});

const scopeGenerateResultSchema = z.object({
  chapters: z.array(
    z.object({
      title: z.string(),
      items: z.array(
        z.object({
          title: z.string(),
          details: z.string().optional(),
        })
      ),
    })
  ),
});

const generatedQuestionSchema = z.object({
  content: z.string(),
  options: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
    })
  ),
  correctAnswers: z.array(z.number().int().min(0)),
  explanations: z.array(
    z.object({
      optionId: z.string(),
      isCorrect: z.boolean(),
      explanation: z.string(),
    })
  ),
  subtopicTags: z.array(z.string()),
  scopeItemId: z.string().nullable().optional(),
});

const questionGenerateResultSchema = z.object({
  questions: z.array(generatedQuestionSchema).optional(),
});

let _client: OpenAI | null = null;

export function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || "dummy",
      baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      fetch: nativeFetch as typeof globalThis.fetch,
    });
  }
  return _client;
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 3000): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      const isConnectionError = e?.error?.type === "APIConnectionError" ||
        e?.message?.includes("Connection error") ||
        e?.message?.includes("EHOSTUNREACH");
      if (!isConnectionError || attempt === retries) throw e;
      console.warn(`[AI] Connection error, retrying (${retries - attempt} left): ${e.message?.substring(0, 100)}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("unreachable");
}

interface TopicInterpretResult {
  needsClarification: boolean;
  clarification?: string;
  suggestedTopics?: string[];
  interpretation?: {
    title: string;
    description: string;
  };
}

interface ExamFormatResult {
  choicesCount: number;
  isMultiSelect: boolean;
  rationale: string;
}

interface GeneratedQuestion {
  content: string;
  options: { id: string; text: string }[];
  correctAnswers: number[];
  explanations: { optionId: string; isCorrect: boolean; explanation: string }[];
  subtopicTags: string[];
  scopeItemId?: string | null;
}

export function getModel(): string {
  return process.env.OPENAI_MODEL || "gpt-4o";
}

export function getModelVariant(variant: "flash" | "thinking"): string {
  if (variant === "flash") return process.env.OPENAI_MODEL_FLASH || process.env.OPENAI_MODEL || "gpt-4o";
  return process.env.OPENAI_MODEL_THINKING || process.env.OPENAI_MODEL || "gpt-4o";
}

export function parseJsonObject(content: string | null): unknown {
  if (!content) throw new Error("AI returned an empty response");

  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI response was not valid JSON");
    return JSON.parse(match[0]);
  }
}

export function getMessageContent(response: unknown): string | null {
  const parsed =
    typeof response === "string" ? parseJsonObject(response) : response;

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("choices" in parsed) ||
    !Array.isArray(parsed.choices)
  ) {
    throw new Error("AI response did not include choices");
  }

  const content = parsed.choices[0]?.message?.content;
  return typeof content === "string" ? content : null;
}

export function validateAiResponse<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  parsed: unknown,
  context: string
): T {
  try {
    return schema.parse(parsed);
  } catch (e) {
    if (e instanceof z.ZodError) {
      throw new Error(`AI response validation failed for ${context}: ${e.message}`);
    }
    throw e;
  }
}

export async function interpretTopic(
  userInput: string
): Promise<TopicInterpretResult> {
  const messages = buildTopicInterpretMessages(userInput);
  const response = await withRetry(() => getClient().chat.completions.create({
    model: getModel(),
    messages,
    response_format: { type: "json_object" },
    temperature: 0.3,
  }));

  const parsed = parseJsonObject(getMessageContent(response));
  return validateAiResponse(
    topicInterpretResultSchema,
    parsed,
    "topic interpretation"
  );
}

export async function detectFormat(
  topicDescription: string
): Promise<ExamFormatResult> {
  const messages = buildFormatDetectMessages(topicDescription);
  const response = await withRetry(() => getClient().chat.completions.create({
    model: getModel(),
    messages,
    response_format: { type: "json_object" },
    temperature: 0.2,
  }));

  const parsed = parseJsonObject(getMessageContent(response));
  return validateAiResponse(examFormatResultSchema, parsed, "format detection");
}

export async function generateScope(
  topicDescription: string
): Promise<{
  chapters: { title: string; items: { title: string; details?: string }[] }[];
}> {
  const messages = buildScopeGenerateMessages(topicDescription);
  const response = await withRetry(() => getClient().chat.completions.create({
    model: getModel(),
    messages,
    response_format: { type: "json_object" },
    temperature: 0.3,
  }));

  const parsed = parseJsonObject(getMessageContent(response));
  return validateAiResponse(scopeGenerateResultSchema, parsed, "scope generation");
}

export async function generateQuestions(params: {
  topic: string;
  format: { choicesCount: number; isMultiSelect: boolean };
  count: number;
  existingHashes: string[];
  subtopicFilter?: string[];
  instructions?: string;
  scopeContext?: string;
  scopePlan?: { id: string; title: string; count: number }[];
}): Promise<GeneratedQuestion[]> {
  const messages = buildQuestionGenerateMessages(params);
  const response = await withRetry(() => getClient().chat.completions.create({
    model: getModel(),
    messages,
    response_format: { type: "json_object" },
    temperature: 0.7,
  }));

  const parsed = parseJsonObject(getMessageContent(response));
  const validated = validateAiResponse(
    questionGenerateResultSchema,
    parsed,
    "question generation"
  );
  return validated.questions || [];
}
