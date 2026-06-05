import { nativeFetch } from "../apps/api/src/env.js";

async function main() {
  console.log("nativeFetch type:", typeof nativeFetch);
  console.log("nativeFetch name:", nativeFetch?.name);
  console.log("BASE_URL:", process.env.OPENAI_BASE_URL);

  try {
    const r = await nativeFetch("http://mac-studio.local:4000/v1/models", {
      headers: { Authorization: "Bearer " + process.env.OPENAI_API_KEY },
    });
    console.log("Fetch OK:", r.status);
  } catch (e: any) {
    console.error("Fetch ERR:", e.message);
  }
}

main();
