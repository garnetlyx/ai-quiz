import { describe, expect, it } from "vitest";
import { splitExplanations } from "../services/explanations";

const option = (id: string) => ({ id, text: `Option ${id}` });
const explanation = (optionId: string, text: string) => ({ optionId, isCorrect: false, explanation: text });

describe("splitExplanations", () => {
  it("shows one explanation once when every option carries the same text", () => {
    const text = "Discount points are a percentage of the principal amount.";
    const result = splitExplanations(
      ["A", "B", "C", "D"].map(option),
      ["A", "B", "C", "D"].map((id) => explanation(id, text))
    );

    expect(result.shared).toBe(text);
    expect(result.perOption.size).toBe(0);
  });

  it("treats whitespace-only differences as the same explanation", () => {
    const result = splitExplanations(
      [option("A"), option("B")],
      [explanation("A", "Same  text."), explanation("B", " Same text. ")]
    );
    expect(result.shared).toBe("Same text.");
  });

  it("keeps distinct per-option explanations next to their options", () => {
    const result = splitExplanations(
      [option("A"), option("B"), option("C")],
      [explanation("A", "Because of X."), explanation("B", "Because of Y."), explanation("C", "")]
    );

    expect(result.shared).toBeNull();
    expect(result.perOption.get("A")).toBe("Because of X.");
    expect(result.perOption.get("B")).toBe("Because of Y.");
    expect(result.perOption.has("C")).toBe(false);
  });

  it("does not hoist a single explanation that belongs to one option", () => {
    const result = splitExplanations([option("A"), option("B")], [explanation("B", "Only B is explained.")]);

    expect(result.shared).toBeNull();
    expect(result.perOption.get("B")).toBe("Only B is explained.");
  });

  it("returns nothing for questions without explanations", () => {
    const result = splitExplanations([option("A")], []);
    expect(result.shared).toBeNull();
    expect(result.perOption.size).toBe(0);
  });
});
