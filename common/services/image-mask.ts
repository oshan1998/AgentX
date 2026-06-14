import sharp from "sharp";

/** Resize a mask to exact dimensions as a greyscale PNG, optionally softening its edges. */
export async function normalizeMask(
  mask: Buffer,
  width: number,
  height: number,
  blurSigma = 0,
): Promise<Buffer> {
  const pipeline = sharp(mask).resize(width, height, { fit: "fill" }).greyscale();
  return (blurSigma > 0 ? pipeline.blur(blurSigma) : pipeline).png().toBuffer();
}

/** Invert a greyscale mask (white ↔ black). */
export function invertMask(mask: Buffer): Promise<Buffer> {
  return sharp(mask).negate().png().toBuffer();
}

/**
 * Apply a greyscale mask (white = keep) as the source image's alpha channel.
 * The mask must already match the source dimensions; see {@link normalizeMask}.
 */
export function applyMaskAsAlpha(sourceImage: Buffer, mask: Buffer): Promise<Buffer> {
  return sharp(sourceImage).removeAlpha().joinChannel(mask).png().toBuffer();
}
