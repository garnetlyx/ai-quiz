import { describe, expect, it } from "vitest";
import { extractMaterialQuestions } from "../src/services/materialExtraction.js";

describe("material extraction", () => {
  it("does not treat a wrapped promissory note explanation as a Note heading", async () => {
    // Wa-agent.pdf page 45, last explanation line before the next sample.
    const text = `Sample Questions
An optionee's rights can be assigned under all of the
following circumstances, EXCEPT when the:
A. option money is $10 or less
B. option money is in the form of a promissory note
C. optionor has died
D. optionee has died
B. If the option money is in the form of a promissory
note, the optionee cannot assign it (nor can his
estate, if the optionee is dead).
A buyer and seller agree upon an option to purchase
with a 60-day option period. When should the parties
agree upon the purchase price?
A. Any point between the signing of the option agreement and closing
B. At closing
C. Before signing the option agreement
D. When the buyer decides to exercise the option
C. An option agreement should contain all of the details.`;
    const { questions } = await extractMaterialQuestions({ filePath: "Wa-agent.pdf", text });
    expect(questions).toHaveLength(2);
    expect(questions[0].answerExplanation).toContain("promissory note, the optionee");
    expect(questions[1].question).toMatch(/^A buyer and seller/);
  });

  it("keeps article-led prompts and lowercase explanation continuations separate", async () => {
    // Wa-agent.pdf, page 2: these are consecutive unnumbered sample questions.
    // The source wraps the second explanation immediately before 'Of all...'.
    const text = `Chapter 1: The Nature of Real Property
Sample Questions
A buyer purchases a rental home that is fully furnished.
The document used to transfer title to the furniture is a:
A. quitclaim deed
B. bill of sale
C. special warranty deed
D. general warranty deed
B. Deeds transfer title to real estate; a bill of sale is
used to transfer title to personal property.
A commercial tenant leases retail space for $1,500
per month. A few months later, the owner of the
complex adds new counters and increases the rent
to $1,750 per month. At the end of the lease term, the
commercial tenant:
A. cannot take the counters with her, because the
owner installed them
B. can take the counters with her if she reimburses
the owner for the fair market value of the counters
C. can take the counters with her if she reimburses
the owner for any damage caused by removal
D. can take the counters with her without any charge
A. A commercial tenant may take trade fixtures-
equipment the tenant installed for use in her
business-with her when she moves out at the end
of the lease. In this case, however, the counters
were added by the owner, not the tenant, so they
would not be considered trade fixtures.
Of all the tests used to determine whether an item is
a fixture, the most important is the:
A. method of attachment
B. intention of the party who attached the item
C. adaptation of the item to the property
D. weight of the item
B. The intention of the party who attached the item is
the most important fixture test.`;

    const result = await extractMaterialQuestions({ filePath: "Wa-agent.pdf", text });
    expect(result.questions).toHaveLength(3);
    expect(result.questions[0].answerExplanation).toBe(
      "Deeds transfer title to real estate; a bill of sale is used to transfer title to personal property."
    );
    expect(result.questions[1].question).toBe(
      "A commercial tenant leases retail space for $1,500 per month. A few months later, the owner of the complex adds new counters and increases the rent to $1,750 per month. At the end of the lease term, the commercial tenant:"
    );
    expect(result.questions[1].answerExplanation).toContain(
      "of the lease. In this case, however, the counters were added by the owner, not the tenant, so they would not be considered trade fixtures."
    );
    expect(result.questions[2].question).toBe(
      "Of all the tests used to determine whether an item is a fixture, the most important is the:"
    );
  });

  it("extracts chapter quiz questions and joins answer key explanations", async () => {
    const text = `Chapter 1: The Nature of Real Property
Chapter Quiz
1. Which right applies to property next to a river?
A. Littoral
B. Riparian
C. Avulsion
D. Reliction
Answer Key
1. B. Riparian rights belong to owners of property next to rivers or streams.`;

    const result = await extractMaterialQuestions({ filePath: "fixture.txt", text });

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]).toMatchObject({
      question: "Which right applies to property next to a river?",
      source: "chapter_question",
      answerLabels: ["B"],
      correctAnswers: [1],
      chapter: { number: 1, title: "The Nature of Real Property" },
      reviewStatus: "ready",
    });
    expect(result.questions[0].answerExplanation).toContain("Riparian rights");
  });

  it("extracts inline sample questions with immediate answer explanations", async () => {
    const text = `Chapter 1: The Nature of Real Property
Sample Questions
The document used to transfer title to furniture is a:
A. quitclaim deed
B. bill of sale
C. special warranty deed
D. general warranty deed
B. Deeds transfer title to real estate; a bill of sale transfers personal property.`;

    const result = await extractMaterialQuestions({ filePath: "fixture.txt", text });

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]).toMatchObject({
      source: "example_question",
      answerLabels: ["B"],
      correctAnswers: [1],
      reviewStatus: "ready",
    });
    expect(result.questions[0].options.map((option) => option.id)).toEqual(["A", "B", "C", "D"]);
  });

  it("extracts sample exam questions and keys by exam number", async () => {
    const text = `Sample Exam 3
1. How many square feet are in a square yard?
A. 3
B. 9
C. 27
D. 81
Answer Key
1A
There are nine square feet in a square yard.`;

    const result = await extractMaterialQuestions({ filePath: "fixture.txt", text });

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]).toMatchObject({
      source: "exam_question",
      answerLabels: ["A"],
      correctAnswers: [0],
      exam: { number: 3, questionNumber: 1 },
    });
    expect(result.questions[0].answerExplanation).toContain("nine square feet");
  });

  it("uses verifier to repair complete questions missing answer keys", async () => {
    const text = `Sample Exam 2
32. If the mortgage amount is $80,000 and the borrower paid $4,800 in discount points, how many discount points were charged?
A. 4
B. 5
C. 6
D. 8`;

    const result = await extractMaterialQuestions({
      filePath: "fixture.txt",
      text,
      verifier: {
        async verify() {
          return {
            answerLabels: ["C"],
            explanation: "$4,800 is 6% of $80,000, so six discount points were charged.",
            confidence: 0.9,
          };
        },
      },
    });

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]).toMatchObject({
      answerLabels: ["C"],
      correctAnswers: [2],
      reviewStatus: "ready",
    });
  });

  it("keeps malformed uploaded question candidates visible for repair", async () => {
    const text = `Chapter 1: The Nature of Real Property
Chapter Quiz
1. Mineral rights associated with real property are always:
B. separable and divisible
C. sold separately from the property
D. an interest in personal property
Answer Key
1. A. Mineral rights are an interest in real property.`;

    const result = await extractMaterialQuestions({ filePath: "fixture.txt", text });

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].reviewStatus).toBe("needs_repair");
    expect(result.questions[0].repairFlags).toContain("missing_or_extra_options");
    expect(result.report.needsRepairQuestions).toBe(1);
    expect(result.report.needsUserReviewQuestions).toBe(0);
    expect("rejectedQuestions" in result.report).toBe(false);
  });

  it("classifies complete questions without answers as user review, not hidden rejection", async () => {
    const text = `Sample Exam 2
32. Which statement about a lease is correct?
A. It is always ownership in fee simple
B. It may create a leasehold estate
C. It transfers title by deed
D. It eliminates all landlord duties`;

    const result = await extractMaterialQuestions({ filePath: "fixture.txt", text });

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].reviewStatus).toBe("needs_user_review");
    expect(result.questions[0].repairFlags).toContain("no_answer_label");
    expect(result.report.manualReviewRate).toBe(1);
  });

  describe("repair engine", () => {
    it("repairs OCR layout pollution", async () => {
      const text = `Chapter 1: The Nature of Real Property
Chapter Quiz
1. [PDF_PAGE 3] Which right applies to property next to a river fi fi?
A. Littoral
B. Riparian
C. Avulsion
D. Reliction
Answer Key
1. B. Riparian rights belong to owners of property next to rivers or streams.`;

      const result = await extractMaterialQuestions({ filePath: "fixture.txt", text });

      expect(result.questions[0].question).not.toContain("PDF_PAGE");
      expect(result.questions[0].question).not.toContain("fi fi");
      expect(result.questions[0].reviewStatus).toBe("auto_repaired");
      expect(result.questions[0].repairActions).toContainEqual(expect.objectContaining({ type: "repair_ocr_layout_pollution", status: "applied" }));
    });

    it("resegments inline prompt options", async () => {
      const text = `Chapter 1: The Nature of Real Property
Chapter Quiz
1. Which term describes river rights? A. Littoral B. Riparian C. Avulsion D. Reliction
A. Placeholder A
B. Placeholder B
Answer Key
1. B. Riparian rights belong to owners of property next to rivers or streams.`;

      const result = await extractMaterialQuestions({ filePath: "fixture.txt", text });

      expect(result.questions[0].question).toBe("Which term describes river rights?");
      expect(result.questions[0].options.map((option) => option.text)).toEqual(["Littoral", "Riparian", "Avulsion", "Reliction"]);
      expect(result.questions[0].repairActions).toContainEqual(expect.objectContaining({ type: "resegment_prompt_and_options", status: "applied" }));
    });

    it("splits merged numbered question prompts", async () => {
      const text = `Chapter 1: The Nature of Real Property
Chapter Quiz
1. Which right applies to rivers? 2. Which right applies to lakes?
A. Littoral
B. Riparian
Answer Key
1. B. Riparian rights belong to owners of property next to rivers or streams.`;

      const result = await extractMaterialQuestions({ filePath: "fixture.txt", text });

      expect(result.questions[0].question).toBe("Which right applies to rivers?");
      expect(result.questions[0].repairActions).toContainEqual(expect.objectContaining({ type: "split_merged_numbered_questions", status: "applied" }));
    });

    it("routes repaired candidates without recovered answers to user review, not auto_repaired", async () => {
      const text = `Chapter 1: The Nature of Real Property
Chapter Quiz
1. Which right applies to rivers? 2. Which right applies to lakes?
A. Littoral
B. Riparian
C. Avulsion
D. Reliction
Answer Key
1. B. Riparian rights belong to owners of property next to rivers or streams.`;

      const result = await extractMaterialQuestions({ filePath: "fixture.txt", text });

      const split = result.questions.find((question) => question.question.includes("lakes"));
      expect(split).toBeDefined();
      expect(split?.answerLabels).toEqual([]);
      expect(split?.repairActions).toContainEqual(expect.objectContaining({ type: "split_merged_numbered_questions", status: "applied" }));
      expect(split?.reviewStatus).toBe("needs_user_review");
    });

    it("trims swallowed option text", async () => {
      const text = `Chapter 1: The Nature of Real Property
Chapter Quiz
1. Which term describes river rights?
A. Littoral
B. Riparian
C. Avulsion
D. Reliction. 2. Which right applies to lakes? A. Littoral B. Riparian C. Avulsion D. Reliction
Answer Key
1. B. Riparian rights belong to owners of property next to rivers or streams.`;

      const result = await extractMaterialQuestions({ filePath: "fixture.txt", text });

      expect(result.questions[0].options.find((option) => option.id === "D")?.text).toBe("Reliction.");
      expect(result.questions[0].repairActions).toContainEqual(expect.objectContaining({ type: "trim_swallowed_option_text", status: "applied" }));
    });

    it("recovers missing options from source context", async () => {
      const text = `Chapter 1: The Nature of Real Property
Chapter Quiz
A. Littoral
1. Which term describes river rights?
B. Riparian
C. Avulsion
D. Reliction
Answer Key
1. B. Riparian rights belong to owners of property next to rivers or streams.`;

      const result = await extractMaterialQuestions({ filePath: "fixture.txt", text });

      expect(result.questions[0].options.map((option) => option.id)).toEqual(["A", "B", "C", "D"]);
      expect(result.questions[0].repairFlags).not.toContain("missing_or_extra_options");
      expect(result.questions[0].repairActions).toContainEqual(expect.objectContaining({ type: "recover_options_from_source_context", status: "applied" }));
    });

    it("recovers short prompts from previous lines", async () => {
      const text = `Chapter 1: The Nature of Real Property
Chapter Quiz
Which term describes river rights?
1. ?
A. Littoral
B. Riparian
C. Avulsion
D. Reliction
Answer Key
1. B. Riparian rights belong to owners of property next to rivers or streams.`;

      const result = await extractMaterialQuestions({ filePath: "fixture.txt", text });

      expect(result.questions[0].question).toBe("Which term describes river rights?");
      expect(result.questions[0].repairActions).toContainEqual(expect.objectContaining({ type: "recover_prompt_from_previous_lines", status: "applied" }));
    });

    it("repairs answer option mapping from explanation text", async () => {
      const text = `Chapter 1: The Nature of Real Property
Chapter Quiz
1. Which term describes river rights?
A. Littoral shore rights
B. Riparian river rights
C. Avulsion land movement
Answer Key
1. D. Riparian river rights are correct for property next to rivers.`;

      const result = await extractMaterialQuestions({ filePath: "fixture.txt", text });

      expect(result.questions[0].answerLabels).toEqual(["B"]);
      expect(result.questions[0].repairActions).toContainEqual(expect.objectContaining({ type: "repair_answer_option_mapping", status: "applied" }));
    });

    it("retries answer key lookup with broader context", async () => {
      const text = `Sample Exam 1
Answer Key
1. B. Riparian rights belong to owners of property next to rivers or streams.
Chapter Quiz
1. Which term describes river rights?
A. Littoral
B. Riparian
C. Avulsion
D. Reliction`;

      const result = await extractMaterialQuestions({ filePath: "fixture.txt", text });

      expect(result.questions[0].answerLabels).toEqual(["B"]);
      expect(result.questions[0].reviewStatus).toBe("auto_repaired");
      expect(result.questions[0].repairActions).toContainEqual(expect.objectContaining({ type: "retry_answer_key_lookup", status: "applied" }));
    });
  });
});
