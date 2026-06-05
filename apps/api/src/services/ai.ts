import OpenAI from "openai";
import { z } from "zod";
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
    });
  }
  return _client;
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

export type AiAgent = "glm" | "deepseek" | "qwen";

const AI_AGENT_MODELS: Record<AiAgent, string> = {
  glm: "glm-5.1",
  deepseek: "deepseek-v4-flash",
  qwen: "Qwen3.5-122B-A10B-4bit",
};

const AI_AGENT_LABELS: Record<AiAgent, string> = {
  glm: "GLM",
  deepseek: "DeepSeek",
  qwen: "Qwen",
};

export const AI_AGENT_OPTIONS: { id: AiAgent; label: string; description: string }[] = [
  { id: "glm", label: "GLM", description: "Balanced — good all-rounder" },
  { id: "deepseek", label: "DeepSeek", description: "Fast — quick responses" },
  { id: "qwen", label: "Qwen", description: "Thorough — large model, careful reasoning" },
];

export function resolveModel(agent: AiAgent): string {
  return AI_AGENT_MODELS[agent] || AI_AGENT_MODELS.glm;
}

export function isValidAgent(value: string): value is AiAgent {
  return value in AI_AGENT_MODELS;
}

export function getAgentLabel(agent: AiAgent): string {
  return AI_AGENT_LABELS[agent];
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
  userInput: string,
  agent: AiAgent = "glm"
): Promise<TopicInterpretResult> {
  const messages = buildTopicInterpretMessages(userInput);
  const response = await getClient().chat.completions.create({
    model: resolveModel(agent),
    messages,
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const parsed = parseJsonObject(getMessageContent(response));
  return validateAiResponse(
    topicInterpretResultSchema,
    parsed,
    "topic interpretation"
  );
}

export async function detectFormat(
  topicDescription: string,
  agent: AiAgent = "glm"
): Promise<ExamFormatResult> {
  const messages = buildFormatDetectMessages(topicDescription);
  const response = await getClient().chat.completions.create({
    model: resolveModel(agent),
    messages,
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  const parsed = parseJsonObject(getMessageContent(response));
  return validateAiResponse(examFormatResultSchema, parsed, "format detection");
}

export async function generateScope(
  topicDescription: string,
  agent: AiAgent = "glm"
): Promise<{
  chapters: { title: string; items: { title: string; details?: string }[] }[];
}> {
  const messages = buildScopeGenerateMessages(topicDescription);
  const response = await getClient().chat.completions.create({
    model: resolveModel(agent),
    messages,
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

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
  agent?: AiAgent;
}): Promise<GeneratedQuestion[]> {
  const messages = buildQuestionGenerateMessages(params);
  const response = await getClient().chat.completions.create({
    model: resolveModel(params.agent || "glm"),
    messages,
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const parsed = parseJsonObject(getMessageContent(response));
  const validated = validateAiResponse(
    questionGenerateResultSchema,
    parsed,
    "question generation"
  );
  return validated.questions || [];
}
