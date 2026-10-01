import type { MaterialQuestion } from "./materialExtraction.js";

// OCR damage that is safe to repair deterministically: fullwidth punctuation,
// a stray leading list number, a glued leading article ("Alisting"), and a
// dropped fi/fl/ff ligature ("de ned", "rm"). Every repair is judged against
// the bank's own vocabulary, never a built-in word list: plain-text sources are
// not OCR output, so the words they contain are the trusted reference.

const LIGATURES = ["fi", "fl", "ffi", "ffl", "ff"];
// Letters, joined across apostrophes so contractions ("we've") stay one token.
const WORD = /(?<![A-Za-z'’])[A-Za-z]+(?![A-Za-z'’])/g;
const MIN_REPAIRED_COUNT = 2;
const MIN_ARTICLE_REMAINDER_COUNT = 5;

export interface TextVocabulary {
  counts: Map<string, number>;
  trusted: Set<string>;
  lowercaseSeen: Set<string>;
}

function questionTexts(question: MaterialQuestion): string[] {
  return [question.question, ...question.options.map((option) => option.text), question.answerExplanation || ""];
}

function isPlainTextSource(question: MaterialQuestion): boolean {
  return !question.sourceLocation.filePath.toLowerCase().includes(".pdf");
}

export function buildTextVocabulary(questions: MaterialQuestion[]): TextVocabulary {
  const counts = new Map<string, number>();
  const trusted = new Set<string>();
  const lowercaseSeen = new Set<string>();
  for (const question of questions) {
    const plain = isPlainTextSource(question);
    for (const text of questionTexts(question)) {
      for (const [word] of text.normalize("NFKC").matchAll(WORD)) {
        const lower = word.toLowerCase();
        counts.set(lower, (counts.get(lower) || 0) + 1);
        if (plain) trusted.add(lower);
        if (word === lower) lowercaseSeen.add(word);
      }
    }
  }
  return { counts, trusted, lowercaseSeen };
}

// Abbreviations such as "NE" or "FHA" are intact even though they are not words.
function isAllCaps(token: string): boolean {
  return token.length > 1 && token === token.toUpperCase();
}

function withCase(original: string, repaired: string): string {
  return /^[A-Z]/.test(original) ? repaired[0].toUpperCase() + repaired.slice(1) : repaired;
}

function repairedWord(vocabulary: TextVocabulary, candidate: string): boolean {
  return (vocabulary.counts.get(candidate) || 0) >= MIN_REPAIRED_COUNT;
}

// "de ned" -> "defined": two fragments whose join with a ligature is a known
// word, where at least one fragment is not itself a trusted word. Adjacent
// token pairs are scanned with a sliding window so "is in uenced" still sees
// the pair ("in", "uenced").
function repairLigaturePairs(text: string, vocabulary: TextVocabulary): string {
  const tokens = [...text.matchAll(WORD)].map((match) => ({ word: match[0], start: match.index!, end: match.index! + match[0].length }));
  let result = "";
  let cursor = 0;
  for (let i = 0; i < tokens.length; i++) {
    const left = tokens[i];
    const right = tokens[i + 1];
    if (!right || text.slice(left.end, right.start) !== " ") continue;
    const lowerLeft = left.word.toLowerCase();
    const lowerRight = right.word.toLowerCase();
    if (vocabulary.trusted.has(lowerLeft) && vocabulary.trusted.has(lowerRight)) continue;
    if (isAllCaps(left.word) || isAllCaps(right.word)) continue;
    const joined = LIGATURES.map((ligature) => `${lowerLeft}${ligature}${lowerRight}`).find((candidate) => repairedWord(vocabulary, candidate));
    if (!joined) continue;
    result += text.slice(cursor, left.start) + withCase(left.word, joined);
    cursor = right.end;
    i += 1;
  }
  return result + text.slice(cursor);
}

// "rm" -> "firm": a token that is not a trusted word, where re-adding the
// ligature produces a word the bank uses.
function repairLigatureTokens(text: string, vocabulary: TextVocabulary): string {
  return text.replace(WORD, (token) => {
    const lower = token.toLowerCase();
    if (lower.length < 2 || vocabulary.trusted.has(lower) || isAllCaps(token)) return token;
    for (const ligature of LIGATURES) {
      const joined = `${ligature}${lower}`;
      if (repairedWord(vocabulary, joined)) return withCase(token, joined);
    }
    return token;
  });
}

// "Alisting" -> "A listing" at a sentence start, when the whole token is never
// seen in running lowercase text and the remainder is a well-attested word.
function repairGluedArticle(text: string, vocabulary: TextVocabulary): string {
  return text.replace(/(^|[.?!:]\s+)(An|A)([a-z]{3,})(?![A-Za-z'’])/g, (match, boundary: string, article: string, rest: string) => {
    const whole = `${article}${rest}`;
    if (vocabulary.lowercaseSeen.has(whole.toLowerCase())) return match;
    if ((vocabulary.counts.get(rest) || 0) < MIN_ARTICLE_REMAINDER_COUNT) return match;
    // A remainder that is itself a damaged word ("rms" of "Arms") means the
    // leading A belongs to the word.
    if (LIGATURES.some((ligature) => repairedWord(vocabulary, `${ligature}${rest}`))) return match;
    return `${boundary}${article} ${rest}`;
  });
}

export function normalizeQuestionText(text: string, vocabulary: TextVocabulary): string {
  let result = text.normalize("NFKC");
  result = result.replace(/^\s*\(?\s*\d{1,3}\.\s+(?=[A-Z])/, "");
  result = repairGluedArticle(result, vocabulary);
  result = repairLigaturePairs(result, vocabulary);
  result = repairLigatureTokens(result, vocabulary);
  return result.replace(/\s+/g, " ").trim();
}

export function normalizeBankText(questions: MaterialQuestion[]): { questions: MaterialQuestion[]; changedCount: number } {
  const vocabulary = buildTextVocabulary(questions);
  let changedCount = 0;
  const result = questions.map((question) => {
    const next: MaterialQuestion = {
      ...question,
      question: normalizeQuestionText(question.question, vocabulary),
      options: question.options.map((option) => ({ ...option, text: normalizeQuestionText(option.text, vocabulary) })),
      answerExplanation: question.answerExplanation
        ? normalizeQuestionText(question.answerExplanation, vocabulary)
        : question.answerExplanation,
    };
    const changed =
      next.question !== question.question ||
      next.answerExplanation !== question.answerExplanation ||
      next.options.some((option, index) => option.text !== question.options[index].text);
    if (!changed) return question;
    changedCount += 1;
    return {
      ...next,
      repairActions: [...question.repairActions, {
        type: "normalize_ocr_text",
        status: "applied" as const,
        note: "Normalized fullwidth punctuation, glued articles, and dropped fi/fl ligatures.",
      }],
    };
  });
  return { questions: result, changedCount };
}
