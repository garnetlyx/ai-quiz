import OpenAI from "openai";
import { buildTopicInterpretMessages } from "../prompts/topic-interpret.js";
import { buildFormatDetectMessages } from "../prompts/format-detect.js";
import { buildQuestionGenerateMessages } from "../prompts/question-generate.js";
import { buildScopeGenerateMessages } from "../prompts/scope-generate.js";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
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

function getModel(): string {
  return process.env.OPENAI_MODEL || "gpt-4o";
}

function parseJsonObject(content: string | null): unknown {
  if (!content) throw new Error("AI returned an empty response");

  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI response was not valid JSON");
    return JSON.parse(match[0]);
  }
}

function getMessageContent(response: unknown): string | null {
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

export async function interpretTopic(
  userInput: string
): Promise<TopicInterpretResult> {
  const messages = buildTopicInterpretMessages(userInput);
  const response = await getClient().chat.completions.create({
    model: getModel(),
    messages,
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  return parseJsonObject(getMessageContent(response)) as TopicInterpretResult;
}

export async function detectFormat(
  topicDescription: string
): Promise<ExamFormatResult> {
  const messages = buildFormatDetectMessages(topicDescription);
  const response = await getClient().chat.completions.create({
    model: getModel(),
    messages,
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  return parseJsonObject(getMessageContent(response)) as ExamFormatResult;
}

export async function generateScope(topicDescription: string): Promise<{
  chapters: { title: string; items: { title: string; details?: string }[] }[];
}> {
  const messages = buildScopeGenerateMessages(topicDescription);
  const response = await getClient().chat.completions.create({
    model: getModel(),
    messages,
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  return parseJsonObject(getMessageContent(response)) as {
    chapters: { title: string; items: { title: string; details?: string }[] }[];
  };
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
  const response = await getClient().chat.completions.create({
    model: getModel(),
    messages,
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const parsed = parseJsonObject(getMessageContent(response)) as {
    questions?: GeneratedQuestion[];
  };
  return parsed.questions || [];
}
