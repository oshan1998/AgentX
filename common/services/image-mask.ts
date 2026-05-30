import sharp from "sharp";

/** Applies a foreground mask as the alpha channel of the source image. */
export async function applyForegroundMaskAsAlpha(
  sourceImage: Buffer,
  foregroundMask: Buffer,
): Promise<Buffer> {
  const sourceMeta = await sharp(sourceImage).metadata();
  const width = sourceMeta.width;
  const height = sourceMeta.height;

  if (!width || !height) {
    throw new Error("Source image dimensions could not be determined.");
  }

  const resizedMask = await sharp(foregroundMask)
    .resize(width, height, { fit: "fill" })
    .greyscale()
    .png()
    .toBuffer();

  return sharp(sourceImage)
    .ensureAlpha()
    .removeAlpha()
    .joinChannel(resizedMask)
    .png()
    .toBuffer();
}

/** Normalizes a mask to grayscale PNG at the given dimensions. */
export async function normalizeMaskPng(
  mask: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  return sharp(mask)
    .resize(width, height, { fit: "fill" })
    .greyscale()
    .png()
    .toBuffer();
}

/** Inverts a grayscale mask (white ↔ black). */
export async function invertMaskPng(mask: Buffer): Promise<Buffer> {
  return sharp(mask).negate().png().toBuffer();
}

export interface GeminiSegmentMaskEntry {
  box_2d: number[];
  mask: string;
}

/** Builds a full-size grayscale foreground mask from a Gemini bbox-relative segmentation entry. */
export async function buildFullMaskFromGeminiSegment(
  entry: GeminiSegmentMaskEntry,
  width: number,
  height: number,
): Promise<Buffer> {
  if (entry.box_2d.length !== 4) {
    throw new Error("Gemini segmentation entry has an invalid box_2d.");
  }

  const [y0n, x0n, y1n, x1n] = entry.box_2d;
  const absY0 = Math.max(0, Math.round((y0n / 1000) * height));
  const absX0 = Math.max(0, Math.round((x0n / 1000) * width));
  const absY1 = Math.min(height, Math.round((y1n / 1000) * height));
  const absX1 = Math.min(width, Math.round((x1n / 1000) * width));
  const bboxWidth = absX1 - absX0;
  const bboxHeight = absY1 - absY0;

  if (bboxWidth < 1 || bboxHeight < 1) {
    throw new Error("Gemini segmentation returned an invalid bounding box.");
  }

  let maskBase64 = entry.mask.trim();
  if (maskBase64.includes("base64,")) {
    maskBase64 = maskBase64.split("base64,").pop() ?? maskBase64;
  }

  const bboxMask = await sharp(Buffer.from(maskBase64, "base64"))
    .resize(bboxWidth, bboxHeight, { fit: "fill" })
    .greyscale()
    .png()
    .toBuffer();

  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite([{ input: bboxMask, left: absX0, top: absY0 }])
    .greyscale()
    .png()
    .toBuffer();
}
