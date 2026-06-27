import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { withBrowserPage } from "../../../common/services/puppeteer-browser.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";

const MAX_TEXT_CHARS = 12_000;

export const fetchWebpageInputSchema = z.object({
  url: z.string().url().describe("Full URL of the page to fetch."),
  waitUntil: z
    .enum(["domcontentloaded", "networkidle0", "networkidle2"])
    .optional()
    .describe(
      "When to consider navigation complete. Use networkidle2 for JS-heavy SPAs. Default: domcontentloaded.",
    ),
});

export type FetchWebpageInput = z.infer<typeof fetchWebpageInputSchema>;

export class FetchWebpageTool implements Tool {
  name = "fetch_webpage";
  description =
    "Fetch a web page and return its readable text content. Use this to read the full content of a specific URL — complement web_search (which only returns snippets) with this tool when you need the actual page body.";
  inputSchema = zodSchemaToJsonInputSchema(fetchWebpageInputSchema);

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const { url, waitUntil } = parseToolInput(this.name, fetchWebpageInputSchema, input);

    const result = await withBrowserPage(async (page) => {
      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      );

      await page.goto(url, {
        waitUntil: waitUntil ?? "domcontentloaded",
        timeout: 30_000,
      });

      const { title, text } = await page.evaluate(() => {
        // Remove noise elements before extracting text
        for (const sel of ["script", "style", "noscript", "nav", "footer", "header"]) {
          document.querySelectorAll(sel).forEach((el) => el.remove());
        }
        return {
          title: document.title ?? "",
          text: (document.body?.innerText ?? "").replace(/\n{3,}/g, "\n\n").trim(),
        };
      });

      return { title, text };
    });

    const truncated = result.text.length > MAX_TEXT_CHARS;
    const text = truncated ? result.text.slice(0, MAX_TEXT_CHARS) + "\n\n[... content truncated ...]" : result.text;

    return {
      url,
      title: result.title,
      text,
      truncated,
      char_count: result.text.length,
    };
  }
}
