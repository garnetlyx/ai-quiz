import { afterEach, describe, expect, it, vi } from "vitest";

describe("searchWeb", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("uses SearXNG results first", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ title: "SearXNG", url: "https://example.com", content: "primary" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { searchWeb } = await import("../src/services/search.js");
    const results = await searchWeb("exam", 3);

    expect(results).toEqual([
      { title: "SearXNG", url: "https://example.com", description: "primary" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to Brave when SearXNG has no results", async () => {
    vi.stubEnv("BRAVE_API_KEY", "brave-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          web: {
            results: [
              {
                title: "Brave",
                url: "https://brave.example",
                description: "fallback",
              },
            ],
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { searchWeb } = await import("../src/services/search.js");
    const results = await searchWeb("exam", 3);

    expect(results[0]).toEqual({
      title: "Brave",
      url: "https://brave.example",
      description: "fallback",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
