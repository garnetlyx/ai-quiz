import { getClient, resolveModel } from "../apps/api/src/services/ai.js";

async function main() {
  const client = getClient();
  
  console.log("Testing Qwen model...");
  try {
    const res = await client.chat.completions.create({
      model: resolveModel("qwen"),
      messages: [{ role: "user", content: "Return JSON: {\"questions\": [{\"content\": \"test\"}]}" }],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 100,
    });
    console.log("Qwen OK:", res.choices[0]?.message?.content?.substring(0, 200));
  } catch (err: any) {
    console.error("Qwen FAILED:", err.message);
  }
}

main();
