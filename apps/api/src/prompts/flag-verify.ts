import type { QuestionOption, OptionExplanation } from "@ai-quiz/shared";

interface FlagVerifyInput {
  questionContent: string;
  options: QuestionOption[];
  correctAnswers: number[];
  explanations: OptionExplanation[];
  flagReason: string;
  flagCategory: string;
  searchResults: Array<{ title: string; url: string; description: string }>;
}

export function buildFlagVerifyMessages(input: FlagVerifyInput) {
  const optionList = input.options
    .map((opt, idx) => {
      const marker = input.correctAnswers.includes(idx) ? " [MARKED CORRECT]" : "";
      const exp = input.explanations.find((e) => e.optionId === opt.id);
      return `${opt.id}. ${opt.text}${marker}${exp ? `\n   Explanation: ${exp.explanation}` : ""}`;
    })
    .join("\n");

  const searchContext =
    input.searchResults.length > 0
      ? input.searchResults
          .map((r) => `- ${r.title}: ${r.description}`)
          .join("\n")
      : "No web search results available.";

  const systemPrompt = {
    role: "system" as const,
    content: `You are a conservative answer verification agent for a quiz application. A user has flagged a question, claiming the marked correct answer may be wrong.

YOUR JOB: Determine whether the marked correct answer is actually correct, using the provided web search results and your knowledge.

CRITICAL RULES:
- Be CONSERVATIVE. Only overturn the answer if the evidence is UNAMBIGUOUS.
- The user might be wrong. Do NOT assume the flag is valid.
- If evidence is mixed, inconclusive, or absent, UPHELD the original answer.
- If web search results are empty, UPHELD the original answer (no evidence to overturn).
- Only mark "corrected" if you are highly confident the original answer is factually wrong AND you can identify the correct answer with certainty.

OUTPUT FORMAT — return valid JSON:
{
  "verdict": "upheld" | "corrected",
  "reasoning": "Clear explanation of why you upheld or corrected the answer. Cite specific evidence from search results when available.",
  "correctedAnswers": [0],  // ONLY if verdict is "corrected" — array of option indices (0-based) that are actually correct
  "correctedExplanations": [  // ONLY if verdict is "corrected"
    {"optionId": "A", "isCorrect": false, "explanation": "..."},
    {"optionId": "B", "isCorrect": true, "explanation": "..."},
    {"optionId": "C", "isCorrect": false, "explanation": "..."},
    {"optionId": "D", "isCorrect": false, "explanation": "..."}
  ],
  "sources": [
    {"url": "https://...", "title": "...", "snippet": "relevant excerpt"}
  ]
}`,
  };

  const userPrompt = {
    role: "user" as const,
    content: `## Flagged Question

**User's complaint (${input.flagCategory})**: ${input.flagReason}

**Question**: ${input.questionContent}

**Options**:
${optionList}

## Web Search Results

${searchContext}

## Your Task

Is the marked correct answer actually correct? Review the evidence and return your verdict as JSON.`,
  };

  return [systemPrompt, userPrompt];
}
