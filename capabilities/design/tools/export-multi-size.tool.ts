import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { logger } from "../../../common/services/logger.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";
import {
  DEFAULT_WORKSPACE_BASE,
  resolveWorkspacePath,
} from "../../../common/services/workspace-path.js";
import {
  DESIGN_PRESET_NAMES,
  DESIGN_SIZE_PRESETS,
  resolvePresetName,
  type DesignSizePresetName,
} from "../design-presets.js";

const variantSchema = z.object({
  outputPath: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fit: z.enum(["cover", "contain", "fill", "inside", "outside"]).optional(),
});

function parsePresetsField(raw: unknown): DesignSizePresetName[] {
  if (Array.isArray(raw)) {
    return raw
      .map((v) => (typeof v === "string" ? resolvePresetName(v) : undefined))
      .filter((v): v is DesignSizePresetName => v !== undefined);
  }
  if (typeof raw === "string" && raw.trim().length > 0) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsePresetsField(parsed);
    } catch {
      return raw
        .split(",")
        .map((s) => resolvePresetName(s.trim()))
        .filter((v): v is DesignSizePresetName => v !== undefined);
    }
  }
  return [];
}

export const exportMultiSizeInputSchema = z.object({
  sourcePath: z.string().min(1).describe("Workspace-relative source image path."),
  outputDir: z
    .string()
    .optional()
    .describe(
      'Directory prefix for preset outputs (e.g. "exports/"). Used with presets; each file is <outputDir><preset>.png.',
    ),
  presets: z
    .union([z.array(z.string()), z.string()])
    .optional()
    .describe(
      `Named sizes: ${DESIGN_PRESET_NAMES.join(", ")}. Array or JSON string (workflow-friendly).`,
    ),
  variants: z
    .array(variantSchema)
    .optional()
    .describe("Explicit width/height/outputPath variants. Merged with preset exports."),
  fit: z
    .enum(["cover", "contain", "fill", "inside", "outside"])
    .optional()
    .describe('Default fit for preset exports. Default "cover".'),
  format: z.enum(["png", "jpeg", "webp"]).optional(),
  quality: z.number().int().min(1).max(100).optional(),
});

export type ExportMultiSizeInput = z.infer<typeof exportMultiSizeInputSchema>;

function inferFormat(
  outputPath: string,
  explicit?: "png" | "jpeg" | "webp",
): "png" | "jpeg" | "webp" {
  if (explicit) return explicit;
  const ext = path.extname(outputPath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "jpeg";
  if (ext === ".webp") return "webp";
  return "png";
}

export class ExportMultiSizeTool implements Tool {
  name = "export_multi_size";
  description =
    "Export a source image to multiple platform sizes using named presets and/or explicit variants.";
  inputSchema = zodSchemaToJsonInputSchema(exportMultiSizeInputSchema);

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const parsed = parseToolInput(this.name, exportMultiSizeInputSchema, input);
    const presetNames = parsePresetsField(parsed.presets);
    const explicitVariants = parsed.variants ?? [];
    const defaultFit = parsed.fit ?? "cover";
    const outputDir = (parsed.outputDir?.trim() || "exports/").replace(/\/?$/, "/");
    const quality = parsed.quality ?? 90;

    const variants = [...explicitVariants];
    for (const presetName of presetNames) {
      const preset = DESIGN_SIZE_PRESETS[presetName];
      variants.push({
        outputPath: `${outputDir}${presetName}.png`,
        width: preset.width,
        height: preset.height,
        fit: defaultFit,
      });
    }

    if (variants.length === 0) {
      throw new Error(
        `${this.name}: provide presets and/or variants. Known presets: ${DESIGN_PRESET_NAMES.join(", ")}.`,
      );
    }

    const absSource = resolveWorkspacePath(
      DEFAULT_WORKSPACE_BASE,
      context.sessionId,
      parsed.sourcePath,
    );

    const results: Array<{
      outputPath: string;
      width: number;
      height: number;
      success: boolean;
    }> = [];

    try {
      logger.info(`export_multi_size: ${parsed.sourcePath} → ${variants.length} variant(s)`);
      for (const variant of variants) {
        const absOutput = resolveWorkspacePath(
          DEFAULT_WORKSPACE_BASE,
          context.sessionId,
          variant.outputPath,
        );
        await mkdir(path.dirname(absOutput), { recursive: true });
        const format = inferFormat(variant.outputPath, parsed.format);
        const fit = variant.fit ?? defaultFit;

        let pipeline = sharp(absSource).resize(variant.width, variant.height, {
          fit,
          background: "#ffffff",
        });

        if (format === "jpeg") {
          await pipeline.jpeg({ quality }).toFile(absOutput);
        } else if (format === "webp") {
          await pipeline.webp({ quality }).toFile(absOutput);
        } else {
          await pipeline.png().toFile(absOutput);
        }

        results.push({
          outputPath: variant.outputPath,
          width: variant.width,
          height: variant.height,
          success: true,
        });
      }

      return {
        success: true,
        sourcePath: parsed.sourcePath,
        exports: results,
        message: `Exported ${results.length} size(s).`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`export_multi_size failed: ${message}`);
      throw new Error(`export_multi_size failed: ${message}`);
    }
  }
}
