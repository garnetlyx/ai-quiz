import type { OptionExplanation, QuestionOption } from "@ai-quiz/shared";

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

// Bank questions store one explanation per question, copied onto every option.
// Show that once; keep genuinely per-option explanations next to their option.
export function splitExplanations(
  options: QuestionOption[],
  explanations: OptionExplanation[]
): { shared: string | null; perOption: Map<string, string> } {
  const present = options
    .map((option) => ({
      id: option.id,
      text: normalize(explanations.find((entry) => entry.optionId === option.id)?.explanation ?? ""),
    }))
    .filter((entry) => entry.text.length > 0);

  const allSame = present.length >= 2 && present.every((entry) => entry.text === present[0].text);
  if (allSame) return { shared: present[0].text, perOption: new Map() };
  return { shared: null, perOption: new Map(present.map((entry) => [entry.id, entry.text])) };
}
