import { generateQuestions } from "./apps/api/src/services/ai.js";

async function main() {
  try {
    const result = await generateQuestions({
      topic: "Washington Real Estate Licensing Exam",
      format: { choicesCount: 4, isMultiSelect: false },
      count: 2,
      existingHashes: [],
      agent: "qwen",
    });
    console.log("Success! Generated:", result.length, "questions");
    console.log(JSON.stringify(result[0], null, 2));
  } catch (err) {
    console.error("FAILED:", err);
  }
}

main();
