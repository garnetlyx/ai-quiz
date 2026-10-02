import { describe, expect, it } from "vitest";
import { parseAuditVerdicts } from "../src/services/materialAuditParse.js";

const verdict = (n: number, extra = "") =>
  `{"n": ${n}, "complete": true, "optionsClean": true, "modelAnswer": "A", "keyVerdict": "correct", "explanationMatches": null, "issues": []${extra}}`;

describe("parseAuditVerdicts", () => {
  it("parses a complete array", () => {
    const result = parseAuditVerdicts(`[${verdict(1)}, ${verdict(2)}]`, 2);
    expect(result).toHaveLength(2);
    expect(result[1].keyVerdict).toBe("correct");
  });

  it("keeps the complete leading verdicts when the output is cut off mid-object", () => {
    const cut = `[${verdict(1)}, ${verdict(2)}, {"n": 3, "complete": tr`;
    expect(parseAuditVerdicts(cut, 3)).toHaveLength(2);
  });

  it("keeps the leading verdicts when the closing bracket is missing", () => {
    expect(parseAuditVerdicts(`[${verdict(1)}, ${verdict(2)}\n`, 5)).toHaveLength(2);
  });

  it("ignores prose around the array and braces inside strings", () => {
    const text = `Here you go:\n[${verdict(1).replace('"issues": []', '"issues": ["option D has a stray } brace"]')}]\nDone.`;
    const result = parseAuditVerdicts(text, 1);
    expect(result[0].issues).toEqual(["option D has a stray } brace"]);
  });

  it("stops at the first verdict that is out of sequence or malformed", () => {
    expect(parseAuditVerdicts(`[${verdict(1)}, ${verdict(3)}]`, 3)).toHaveLength(1);
    expect(parseAuditVerdicts(`[${verdict(1)}, {"n": 2, "complete": "yes"}]`, 2)).toHaveLength(1);
  });

  it("throws when no verdict can be read at all", () => {
    expect(() => parseAuditVerdicts("sorry, I cannot", 3)).toThrow(/no verdicts/i);
    expect(() => parseAuditVerdicts(`[{"n": 2}]`, 3)).toThrow(/no verdicts/i);
  });
});
