import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export function buildQuestionGenerateMessages(params: {
  topic: string;
  format: { choicesCount: number; isMultiSelect: boolean };
  count: number;
  existingHashes: string[];
  subtopicFilter?: string[];
  scopeContext?: string;
  scopePlan?: { id: string; title: string; count: number }[];
}): ChatCompletionMessageParam[] {
  const { topic, format, count, existingHashes, subtopicFilter, scopeContext, scopePlan } = params;

  let prompt = `Generate ${count} realistic exam questions for: "${topic}"

Format requirements:
- Each question has exactly ${format.choicesCount} answer choices (labeled A through ${String.fromCharCode(64 + format.choicesCount)})
- ${format.isMultiSelect ? "Questions may have multiple correct answers (multi-select)" : "Each question has exactly one correct answer (single-select)"}
- For each option, provide a detailed explanation of why it is correct or incorrect
- Assign 1-3 subtopic tags to each question
- Include the matching "scopeItemId" for every question`;

  if (scopeContext) {
    prompt += `\n\nStudy scope and supplemental material:\n${scopeContext}`;
  }

  if (scopePlan && scopePlan.length > 0) {
    prompt += `\n\nQuestion distribution plan:\n${scopePlan
      .map((item) => `- Generate ${item.count} question(s) for scopeItemId ${item.id}: ${item.title}`)
      .join("\n")}`;
  }

  if (subtopicFilter && subtopicFilter.length > 0) {
    prompt += `\n- Focus specifically on these subtopics: ${subtopicFilter.join(", ")}`;
  }

  if (existingHashes.length > 0) {
    prompt += `\n- There are ${existingHashes.length} existing questions. Generate NEW, different questions that don't repeat the same content.`;
  }

  prompt += `

Respond in JSON format:
{
  "questions": [
    {
      "content": "question text",
      "options": [
        { "id": "A", "text": "option text" },
        ...
      ],
      "correctAnswers": [0],
      "scopeItemId": "scope item id from the distribution plan",
      "explanations": [
        { "optionId": "A", "isCorrect": false, "explanation": "why this is wrong" },
        ...
      ],
      "subtopicTags": ["tag1", "tag2"]
    }
  ]
}

Note: correctAnswers uses 0-based indices (0 = first option, 1 = second, etc.)`;

  return [
    {
      role: "system",
      content:
        "You are an expert exam question generator. Create authentic, realistic practice questions that match the style and difficulty of actual standardized exams.",
    },
    { role: "user", content: prompt },
  ];
}
