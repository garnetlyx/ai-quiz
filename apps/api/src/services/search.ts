interface SearchResult {
  title: string;
  url: string;
  description: string;
}

interface FactCheckResult {
  relevant: boolean;
  context: string;
}

const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search";
const SEARXNG_BASE_URL = process.env.SEARXNG_BASE_URL || "http://localhost:8080";

async function searchSearxng(
  query: string,
  count: number
): Promise<SearchResult[]> {
  if (!SEARXNG_BASE_URL) return [];

  const url = `${SEARXNG_BASE_URL.replace(/\/$/, "")}/search?q=${encodeURIComponent(query)}&format=json&categories=general`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) return [];

  const data = (await res.json()) as {
    results?: {
      title?: string;
      url?: string;
      content?: string;
      description?: string;
    }[];
  };

  return (data.results || [])
    .slice(0, count)
    .map((result) => ({
      title: result.title || "Untitled result",
      url: result.url || "",
      description: result.content || result.description || "",
    }))
    .filter((result) => result.url || result.description);
}

async function searchBrave(
  query: string,
  count: number
): Promise<SearchResult[]> {
  if (!BRAVE_API_KEY) return [];

  const url = `${BRAVE_API_URL}?q=${encodeURIComponent(query)}&count=${count}`;
  const res = await fetch(url, {
    headers: { "X-Subscription-Token": BRAVE_API_KEY },
  });

  if (!res.ok) return [];

  const data = (await res.json()) as {
    web?: { results?: { title: string; url: string; description: string }[] };
  };
  return (data.web?.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    description: r.description,
  }));
}

export async function searchWeb(
  query: string,
  count = 5
): Promise<SearchResult[]> {
  try {
    const searxngResults = await searchSearxng(query, count);
    if (searxngResults.length > 0) return searxngResults;
    return searchBrave(query, count);
  } catch {
    try {
      return await searchBrave(query, count);
    } catch {
      return [];
    }
  }
}

export async function factCheckQuestion(
  questionContent: string
): Promise<FactCheckResult | null> {
  const results = await searchWeb(questionContent);
  if (results.length === 0) return null;

  return {
    relevant: true,
    context: results.map((r) => `${r.title}: ${r.description}`).join("\n"),
  };
}
