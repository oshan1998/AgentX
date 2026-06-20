import puppeteer, { type Browser, type Page } from "puppeteer";

const DEFAULT_CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

/**
 * Launch headless Chrome for HTML rendering (PDF/PNG). Uses CHROME_PATH or
 * PUPPETEER_EXECUTABLE_PATH when set; otherwise tries common install locations,
 * then Puppeteer's bundled browser.
 */
export async function launchHeadlessBrowser(): Promise<Browser> {
  const envPath = process.env.CHROME_PATH ?? process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = envPath ? [envPath] : DEFAULT_CHROME_PATHS;

  let lastError: unknown;
  for (const executablePath of candidates) {
    try {
      return await puppeteer.launch({
        headless: true,
        executablePath,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
    } catch (error) {
      lastError = error;
    }
  }

  try {
    return await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const hint =
      lastError instanceof Error ? lastError.message : String(lastError ?? "unknown");
    throw new Error(
      `Failed to launch headless browser: ${msg}. Tried: ${candidates.join(", ")}. Last: ${hint}`,
    );
  }
}

/** Run work against a single page; browser is always closed afterward. */
export async function withBrowserPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const browser = await launchHeadlessBrowser();
  try {
    const page = await browser.newPage();
    return await fn(page);
  } finally {
    await browser.close();
  }
}
