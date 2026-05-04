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

export async function searchWeb(
  query: string,
  count = 5
): Promise<SearchResult[]> {
  if (!BRAVE_API_KEY) return [];

  try {
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
  } catch {
    return [];
  }
}

export async function factCheckQuestion(
  questionContent: string
): Promise<FactCheckResult | null> {
  if (!BRAVE_API_KEY) return null;

  const results = await searchWeb(questionContent);
  if (results.length === 0) return null;

  return {
    relevant: true,
    context: results.map((r) => `${r.title}: ${r.description}`).join("\n"),
  };
}
