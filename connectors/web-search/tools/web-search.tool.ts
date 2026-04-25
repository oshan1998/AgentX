import type { Tool, ToolContext } from "../../../interfaces/types.js";

interface TavilySearchResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
}

interface TavilySearchResponse {
  query?: string;
  results?: TavilySearchResult[];
}

export class WebSearchTool implements Tool {
  name = "web_search";
  description = "Search the web with Tavily and return top results.";

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const query = input.query;
    const maxResultsRaw = input.maxResults;

    if (typeof query !== "string" || query.trim().length === 0) {
      throw new Error("web_search requires { query: string }.");
    }

    const maxResults =
      typeof maxResultsRaw === "number" && Number.isFinite(maxResultsRaw)
        ? Math.max(1, Math.min(10, Math.floor(maxResultsRaw)))
        : 5;

    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      throw new Error("Missing TAVILY_API_KEY in environment.");
    }

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        search_depth: "basic",
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Tavily web_search failed (${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as TavilySearchResponse;
    const results = (data.results ?? []).slice(0, maxResults);

    return results.map((result) => ({
      title: result.title ?? "",
      url: result.url ?? "",
      snippet: result.content ?? "",
      score: result.score ?? 0,
    }));
  }
}
