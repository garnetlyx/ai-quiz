import { describe, it, expect } from "vitest";
import { build } from "../src/app.js";

describe("Health endpoint", () => {
  it("returns ok", async () => {
    const app = await build();
    const res = await app.inject({
      method: "GET",
      url: "/api/health",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });
});
