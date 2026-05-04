import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export function buildTopicInterpretMessages(
  userInput: string
): ChatCompletionMessageParam[] {
  return [
    {
      role: "system",
      content: `You are an exam preparation assistant. A user will describe an exam they want to practice for.
Analyze their input and determine if it's clear enough to generate quiz questions.

If the input is clear and specific enough:
- Set needsClarification to false
- Provide an interpretation with a clear title and description

If the input is ambiguous or too vague:
- Set needsClarification to true
- Provide a clarification question
- Suggest 3-5 specific topics they could choose from

Respond in JSON format:
{
  "needsClarification": boolean,
  "clarification": string | null,
  "suggestedTopics": string[] | null,
  "interpretation": { "title": string, "description": string } | null
}`,
    },
    {
      role: "user",
      content: userInput,
    },
  ];
}
