export const MATERIAL_AUDIT_PROMPT_VERSION = "material-audit-v1";

export interface MaterialAuditItem {
  n: number;
  question: string;
  options: Record<string, string>;
  keyedAnswer: string;
  explanation: string | null;
}

export function buildMaterialAuditPrompt(topicDescription: string, items: MaterialAuditItem[]): string {
  return `You are auditing multiple-choice practice questions for: ${topicDescription}. The questions were extracted by OCR from scanned textbooks and may be corrupted.

For EACH item, judge it strictly as a student would see it:
1. "complete": is the question text a complete, self-contained, answerable question? (false if it starts mid-sentence, is truncated, or contains text from other questions/explanations)
2. "optionsClean": are A-D four distinct, well-formed answer choices? (false if an option contains other questions, explanation text, merged options, or garbage)
3. "modelAnswer": solve the question yourself from subject knowledge BEFORE looking at keyedAnswer. One letter A-D, or null if unanswerable.
4. "keyVerdict": "correct" if keyedAnswer is the right answer, "wrong" if another option is clearly right, "unsure" if ambiguous or the item is too corrupted to tell.
5. "explanationMatches": does the explanation support the keyed answer and belong to this question? (null if no explanation)
6. "issues": short list of concrete problems (empty if none).

Minor OCR typos (e.g. "Aproperty", missing "fi" letters, fullwidth punctuation) do NOT make an item incomplete; mention them in issues only.

Output ONLY a JSON array, one object per item, in input order, with keys: n, complete, optionsClean, modelAnswer, keyVerdict, explanationMatches, issues. No prose, no code fences.

ITEMS:
${JSON.stringify(items, null, 1)}`;
}
