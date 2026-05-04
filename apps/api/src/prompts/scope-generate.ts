import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export function buildScopeGenerateMessages(
  description: string
): ChatCompletionMessageParam[] {
  return [
    {
      role: "system",
      content:
        "You create concise exam prep syllabi. Return only valid JSON with chapters and subtopics.",
    },
    {
      role: "user",
      content: `Create a balanced chapter and subtopic list for this exam prep topic: "${description}"

Return JSON:
{
  "chapters": [
    {
      "title": "chapter name",
      "items": [
        { "title": "subtopic name", "details": "short generation guidance" }
      ]
    }
  ]
}

Use 3-8 chapters and 2-8 subtopics per chapter. Keep names practical for question distribution.`,
    },
  ];
}
