# Prepare images for design

Workflow prep skill: get images into the workspace at usable sizes.

1. Use `outputDir` default `assets/` if omitted.
2. For each URL in `imageUrls`, call **`download_image`** with `outputPath` like `{{outputDir}}/image-0.jpg`, `image-1.jpg`, etc.
3. Call **`read_image_metadata`** on each downloaded file.
4. If `maxWidth` / `maxHeight` are set (defaults 1920×1920), call **`crop_and_resize`** with `fit: "inside"` to `{{outputDir}}/normalized/image-N.jpg` when the source exceeds those bounds.
5. Respond with a manifest: original path, normalized path (if any), width, height.

Do not run layout or typography—only asset preparation.
