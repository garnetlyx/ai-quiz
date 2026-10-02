import type { MaterialAuditVerdict } from "./materialBank.js";

const LETTERS = new Set(["A", "B", "C", "D"]);

// Top-level {...} objects inside the first array in the text, in order. Braces
// inside strings do not count, and a final unfinished object is dropped.
function leadingObjects(text: string): string[] {
  const start = text.indexOf("[");
  if (start < 0) return [];
  const objects: string[] = [];
  let depth = 0;
  let objectStart = -1;
  let inString = false;
  for (let i = start + 1; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === "\\") i += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") {
      if (depth === 0) objectStart = i;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        objects.push(text.slice(objectStart, i + 1));
        objectStart = -1;
      }
    } else if (char === "]" && depth === 0) break;
  }
  return objects;
}

function toVerdict(raw: Record<string, unknown>, expectedN: number): MaterialAuditVerdict | null {
  if (raw.n !== expectedN) return null;
  if (typeof raw.complete !== "boolean" || typeof raw.optionsClean !== "boolean") return null;
  if (!["correct", "wrong", "unsure"].includes(raw.keyVerdict as string)) return null;
  return {
    complete: raw.complete,
    optionsClean: raw.optionsClean,
    modelAnswer: LETTERS.has(raw.modelAnswer as string) ? (raw.modelAnswer as MaterialAuditVerdict["modelAnswer"]) : null,
    keyVerdict: raw.keyVerdict as MaterialAuditVerdict["keyVerdict"],
    explanationMatches: typeof raw.explanationMatches === "boolean" ? raw.explanationMatches : null,
    issues: Array.isArray(raw.issues) ? raw.issues.map(String) : [],
  };
}

// Reads as many in-order, well-formed verdicts as the model produced (at most
// `count`). Models sometimes stop mid-array; the complete leading verdicts are
// still good and the caller re-asks only for the rest.
export function parseAuditVerdicts(output: string, count: number): MaterialAuditVerdict[] {
  const verdicts: MaterialAuditVerdict[] = [];
  for (const text of leadingObjects(output)) {
    if (verdicts.length >= count) break;
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(text) as Record<string, unknown>;
    } catch {
      break;
    }
    const verdict = toVerdict(raw, verdicts.length + 1);
    if (!verdict) break;
    verdicts.push(verdict);
  }
  if (verdicts.length === 0) throw new Error("no verdicts could be read from the model output");
  return verdicts;
}
