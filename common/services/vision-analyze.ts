import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export interface VisionAnalyzeOptions {
  imagePath: string;
  prompt: string;
}

export interface VisionAnalyzeResult {
  description: string;
  provider: string;
}

function mimeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

async function analyzeWithOpenAI(
  absPath: string,
  prompt: string,
): Promise<VisionAnalyzeResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const buffer = await readFile(absPath);
  const mime = mimeForPath(absPath);
  const model = process.env.OPENAI_VISION_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            {
              type: "input_image",
              image_url: `data:${mime};base64,${buffer.toString("base64")}`,
            },
          ],
        },
      ],
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI vision request failed (${response.status}): ${errorText}`);
  }

  const payload = (await response.json()) as {
    output_text?: string;
    output?: Array<{
      content?: Array<{ type?: string; text?: string }>;
    }>;
  };

  let text = payload.output_text ?? "";
  if (!text && payload.output) {
    for (const item of payload.output) {
      for (const part of item.content ?? []) {
        if (part.type === "output_text" && part.text) {
          text += part.text;
        }
      }
    }
  }

  if (!text.trim()) {
    throw new Error("OpenAI vision returned empty text.");
  }

  return { description: text.trim(), provider: "openai" };
}

async function analyzeWithGemini(
  absPath: string,
  prompt: string,
): Promise<VisionAnalyzeResult> {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    throw new Error("GOOGLE_CLOUD_PROJECT is not set.");
  }

  const { VertexAI } = await import("@google-cloud/vertexai");
  const location = process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";
  const modelName = process.env.GEMINI_VISION_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-1.5-flash";

  const buffer = await readFile(absPath);
  const mime = mimeForPath(absPath);

  const vertexAI = new VertexAI({ project: projectId, location });
  const model = vertexAI.getGenerativeModel({ model: modelName });

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          { inlineData: { mimeType: mime, data: buffer.toString("base64") } },
        ],
      },
    ],
  });

  const response = await result.response;
  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text?.trim()) {
    throw new Error("Gemini vision returned empty text.");
  }

  return { description: text.trim(), provider: "gemini" };
}

/**
 * Describes an image using the configured vision provider, with metadata fallback.
 */
export async function analyzeImage(
  options: VisionAnalyzeOptions,
): Promise<VisionAnalyzeResult & { fallback?: boolean }> {
  const { imagePath, prompt } = options;
  const absPath = path.resolve(imagePath);

  const provider = (process.env.VISION_PROVIDER ?? process.env.LLM_PROVIDER ?? "openai")
    .toLowerCase()
    .trim();

  try {
    if (provider === "gemini") {
      return await analyzeWithGemini(absPath, prompt);
    }
    if (provider === "openai") {
      return await analyzeWithOpenAI(absPath, prompt);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const meta = await sharp(absPath).metadata();
    return {
      description: `Vision unavailable (${message}). Image metadata: ${meta.width ?? "?"}×${meta.height ?? "?"} ${meta.format ?? "unknown"}. Re-run with VISION_PROVIDER=openai or gemini and API credentials.`,
      provider: "metadata_fallback",
      fallback: true,
    };
  }

  const meta = await sharp(absPath).metadata();
  return {
    description: `Vision not configured (VISION_PROVIDER=${provider}). Image metadata: ${meta.width ?? "?"}×${meta.height ?? "?"} ${meta.format ?? "unknown"}.`,
    provider: "metadata_fallback",
    fallback: true,
  };
}
