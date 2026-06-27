import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import {
  downloadImageFromUrl,
  inferImageExtension,
} from "../../../common/services/image-download.js";
import { logger } from "../../../common/services/logger.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";
import {
  DEFAULT_WORKSPACE_BASE,
  resolveWorkspacePath,
} from "../../../common/services/workspace-path.js";

interface UnsplashPhoto {
  id?: string;
  width?: number;
  height?: number;
  alt_description?: string | null;
  description?: string | null;
  urls?: {
    raw?: string;
    full?: string;
    regular?: string;
    small?: string;
    thumb?: string;
  };
  links?: {
    html?: string;
    download_location?: string;
  };
  user?: {
    name?: string;
    links?: { html?: string };
  };
}

interface UnsplashSearchResponse {
  total?: number;
  results?: UnsplashPhoto[];
}

export const searchStockImagesInputSchema = z.object({
  query: z.string().min(1).describe("Search keywords for stock photos."),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("Number of results (1–10). Default 5."),
  orientation: z
    .enum(["landscape", "portrait", "squarish"])
    .optional()
    .describe("Filter by orientation."),
  downloadPath: z
    .string()
    .optional()
    .describe(
      "If set, download the first result to this workspace path (e.g. assets/stock-hero.jpg).",
    ),
});

export type SearchStockImagesInput = z.infer<typeof searchStockImagesInputSchema>;

export class SearchStockImagesTool implements Tool {
  name = "search_stock_images";
  description =
    "Search Unsplash for royalty-free stock photos. Optionally download the top result into the workspace.";
  inputSchema = zodSchemaToJsonInputSchema(searchStockImagesInputSchema);

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const parsed = parseToolInput(this.name, searchStockImagesInputSchema, input);
    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!accessKey) {
      throw new Error("Missing UNSPLASH_ACCESS_KEY in environment.");
    }

    const maxResults = parsed.maxResults ?? 5;
    const params = new URLSearchParams({
      query: parsed.query,
      per_page: String(maxResults),
      content_filter: "high",
    });
    if (parsed.orientation) {
      params.set("orientation", parsed.orientation);
    }

    const searchUrl = `https://api.unsplash.com/search/photos?${params.toString()}`;
    const response = await fetch(searchUrl, {
      headers: {
        Authorization: `Client-ID ${accessKey}`,
        "Accept-Version": "v1",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Unsplash search failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as UnsplashSearchResponse;
    const results = (data.results ?? []).slice(0, maxResults).map((photo) => ({
      id: photo.id ?? "",
      width: photo.width ?? null,
      height: photo.height ?? null,
      description: photo.alt_description ?? photo.description ?? "",
      previewUrl: photo.urls?.small ?? photo.urls?.regular ?? "",
      fullUrl: photo.urls?.regular ?? photo.urls?.full ?? "",
      pageUrl: photo.links?.html ?? "",
      photographer: photo.user?.name ?? "",
      photographerUrl: photo.user?.links?.html ?? "",
      attribution: photo.user?.name
        ? `Photo by ${photo.user.name} on Unsplash`
        : "Photo on Unsplash",
    }));

    let downloaded: { outputPath: string; url: string } | undefined;
    if (parsed.downloadPath && results[0]?.fullUrl) {
      const url = results[0].fullUrl;
      logger.info(`Downloading Unsplash result → ${parsed.downloadPath}`);
      const { buffer, contentType } = await downloadImageFromUrl({ url });
      const ext = inferImageExtension(contentType, url);
      let outputPath = parsed.downloadPath;
      if (!path.extname(outputPath)) {
        outputPath += ext;
      }
      const absOutput = resolveWorkspacePath(
        DEFAULT_WORKSPACE_BASE,
        context.sessionId,
        outputPath,
      );
      await mkdir(path.dirname(absOutput), { recursive: true });
      await writeFile(absOutput, buffer);
      downloaded = { outputPath, url };
    }

    return {
      query: parsed.query,
      total: data.total ?? results.length,
      results,
      downloaded,
    };
  }
}
