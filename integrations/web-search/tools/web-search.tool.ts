import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";

interface TavilySearchResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
}

interface TavilySearchResponse {
  query?: string;
  results?: TavilySearchResult[];
  images?: string[];
}

export const webSearchInputSchema = z.object({
  query: z.string().min(1).describe("Search query."),
  maxResults: z
    .number()
    .finite()
    .optional()
    .describe("1–10; default 5."),
  includeImages: z
    .boolean()
    .optional()
    .describe("Whether to include a list of relevant image URLs in the response."),
});

export type WebSearchInput = z.infer<typeof webSearchInputSchema>;

export class WebSearchTool implements Tool {
  name = "web_search";
  description = "Search the web with Tavily and return top results.";
  inputSchema = zodSchemaToJsonInputSchema(webSearchInputSchema);

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const { query, maxResults: maxResultsRaw, includeImages } = parseToolInput(this.name, webSearchInputSchema, input);

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
        include_images: includeImages ?? false,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Tavily web_search failed (${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as TavilySearchResponse;
    const results = (data.results ?? []).slice(0, maxResults);

    const mappedResults = results.map((result) => ({
      title: result.title ?? "",
      url: result.url ?? "",
      snippet: result.content ?? "",
      score: result.score ?? 0,
    }));

    if (includeImages) {
      return {
        results: mappedResults,
        images: data.images ?? [],
      };
    }

    return mappedResults;
  }
}
