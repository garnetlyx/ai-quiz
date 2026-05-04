import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export function buildFormatDetectMessages(
  topicDescription: string
): ChatCompletionMessageParam[] {
  return [
    {
      role: "system",
      content: `You are an exam format detection assistant. Given an exam description, determine the typical format:
- How many answer choices per question (usually 4, sometimes 3 or 5)
- Whether it's single-select or multi-select

Respond in JSON format:
{
  "choicesCount": number,
  "isMultiSelect": boolean,
  "rationale": string
}`,
    },
    {
      role: "user",
      content: topicDescription,
    },
  ];
}
