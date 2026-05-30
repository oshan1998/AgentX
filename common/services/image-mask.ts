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

/** A polygon as ordered [x, y] vertices, normalized to a 0-1000 coordinate space. */
export type NormalizedPolygon = Array<[number, number]>;

/** A foreground subject as one or more silhouette polygons plus a fallback bounding box. */
export interface ForegroundShape {
  /** Silhouette polygons (each a list of [x, y] points, normalized 0-1000). */
  polygons: NormalizedPolygon[];
  /** Optional [y0, x0, y1, x1] bounding box (normalized 0-1000) used as a fallback. */
  box?: [number, number, number, number];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function polygonToSvgPoints(polygon: NormalizedPolygon, width: number, height: number): string {
  return polygon
    .map(([x, y]) => {
      const px = clamp((x / 1000) * width, 0, width);
      const py = clamp((y / 1000) * height, 0, height);
      return `${px.toFixed(2)},${py.toFixed(2)}`;
    })
    .join(" ");
}

function boxToSvgRect(
  box: [number, number, number, number],
  width: number,
  height: number,
): string {
  const [y0, x0, y1, x1] = box;
  const left = clamp((Math.min(x0, x1) / 1000) * width, 0, width);
  const top = clamp((Math.min(y0, y1) / 1000) * height, 0, height);
  const right = clamp((Math.max(x0, x1) / 1000) * width, 0, width);
  const bottom = clamp((Math.max(y0, y1) / 1000) * height, 0, height);
  const rectWidth = Math.max(0, right - left);
  const rectHeight = Math.max(0, bottom - top);
  return `<rect x="${left.toFixed(2)}" y="${top.toFixed(2)}" width="${rectWidth.toFixed(2)}" height="${rectHeight.toFixed(2)}" fill="white"/>`;
}

/**
 * Rasterizes a foreground shape (silhouette polygons, or a bounding box as fallback)
 * into a full-size grayscale mask PNG (white = foreground, black = background).
 *
 * Unlike asking a vision model to emit a base64-encoded PNG mask — which models cannot
 * produce as byte-valid binary — polygon vertices are plain numbers the model emits reliably.
 */
export async function buildMaskFromForegroundShape(
  shape: ForegroundShape,
  width: number,
  height: number,
): Promise<Buffer> {
  const usablePolygons = (shape.polygons ?? []).filter((polygon) => polygon.length >= 3);

  let shapesSvg: string;
  if (usablePolygons.length > 0) {
    shapesSvg = usablePolygons
      .map(
        (polygon) =>
          `<polygon points="${polygonToSvgPoints(polygon, width, height)}" fill="white"/>`,
      )
      .join("");
  } else if (shape.box && shape.box.length === 4) {
    shapesSvg = boxToSvgRect(shape.box, width, height);
  } else {
    throw new Error("Foreground segmentation returned no usable polygon or bounding box.");
  }

  const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="black"/>${shapesSvg}</svg>`;

  return sharp(Buffer.from(maskSvg)).greyscale().png().toBuffer();
}
