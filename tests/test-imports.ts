import { nativeFetch } from "../apps/api/src/env.js";

async function test(label: string) {
  const baseUrl = process.env.OPENAI_BASE_URL ?? "http://localhost:4000";
  try {
    const r = await nativeFetch(`${baseUrl}/v1/models`, {
      headers: { Authorization: "Bearer " + process.env.OPENAI_API_KEY },
      signal: AbortSignal.timeout(5000),
    });
    console.log(label, "OK:", r.status);
  } catch (e: any) {
    console.error(label, "FAIL:", e.message);
  }
}

async function main() {
  await test("1. env only");

  // Import app (which imports all routes, services, etc.)
  const { build } = await import("../apps/api/src/app.js");
  await test("2. after app import");

  // Actually build the app (starts DB connections, etc.)
  const app = await build();
  await test("3. after build()");

  await app.close();
}

main();
