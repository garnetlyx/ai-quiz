import { afterEach, describe, expect, it, vi } from "vitest";

describe("searchWeb", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("uses Exa results first", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'data: {"result":{"content":[{"type":"text","text":"Exa result content"}]}}\n',
    });
    vi.stubGlobal("fetch", fetchMock);

    const { searchWeb } = await import("../src/services/search.js");
    const results = await searchWeb("exam", 3);

    expect(results).toEqual([
      { title: "Exa Web Search", url: "", description: "Exa result content" },
    ]);
  });

  it("falls back to SearXNG when Exa returns no results", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "data: {}\n",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { title: "SearXNG", url: "https://example.com", content: "primary" },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { searchWeb } = await import("../src/services/search.js");
    const results = await searchWeb("exam", 3);

    expect(results).toEqual([
      { title: "SearXNG", url: "https://example.com", description: "primary" },
    ]);
  });

  it("falls back to Brave when Exa and SearXNG have no results", async () => {
    vi.stubEnv("BRAVE_API_KEY", "brave-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "data: {}\n",
      })
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

    expect(results).toEqual([
      {
        title: "Brave",
        url: "https://brave.example",
        description: "fallback",
      },
    ]);
  });

  it("skips Exa when it fails and uses SearXNG", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { title: "SearXNG after Exa fail", url: "https://example.com", content: "fallback-path" },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { searchWeb } = await import("../src/services/search.js");
    const results = await searchWeb("exam", 3);

    expect(results).toEqual([
      { title: "SearXNG after Exa fail", url: "https://example.com", description: "fallback-path" },
    ]);
  });
});
