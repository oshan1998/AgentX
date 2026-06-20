import type { Tool } from "../../common/interfaces/types.js";
import { AddImageOverlayTool } from "../../capabilities/design/tools/add-image-overlay.tool.js";
import { ApplyImageTransformTool } from "../../capabilities/design/tools/apply-image-transform.tool.js";
import { ComposeLayersTool } from "../../capabilities/design/tools/compose-layers.tool.js";
import { CropAndResizeTool } from "../../capabilities/design/tools/crop-and-resize.tool.js";
import { DetectImageRegionTool } from "../../capabilities/design/tools/detect-image-region.tool.js";
import { DownloadImageTool } from "../../capabilities/design/tools/download-image.tool.js";
import { EditImageTool } from "../../capabilities/design/tools/edit-image.tool.js";
import { ExportMultiSizeTool } from "../../capabilities/design/tools/export-multi-size.tool.js";
import { GenerateImageTool } from "../../capabilities/design/tools/generate-image.tool.js";
import { InspectImageTool } from "../../capabilities/design/tools/inspect-image.tool.js";
import { ReadImageMetadataTool } from "../../capabilities/design/tools/read-image-metadata.tool.js";
import { RemoveBackgroundTool } from "../../capabilities/design/tools/remove-background.tool.js";
import { RenderHtmlToPngTool } from "../../capabilities/design/tools/render-html-to-png.tool.js";
import { RenderSvgToPngTool } from "../../capabilities/design/tools/render-svg-to-png.tool.js";
import { WriteSvgTool } from "../../capabilities/design/tools/write-svg.tool.js";

/**
 * Static manifest of the design capability's tools. Static imports (vs the
 * dynamic directory loader) make the server bundleable into a standalone
 * artifact via esbuild. Add new design tools here.
 */
export function createDesignTools(): Tool[] {
  return [
    new AddImageOverlayTool(),
    new ApplyImageTransformTool(),
    new ComposeLayersTool(),
    new CropAndResizeTool(),
    new DetectImageRegionTool(),
    new DownloadImageTool(),
    new EditImageTool(),
    new ExportMultiSizeTool(),
    new GenerateImageTool(),
    new InspectImageTool(),
    new ReadImageMetadataTool(),
    new RemoveBackgroundTool(),
    new RenderHtmlToPngTool(),
    new RenderSvgToPngTool(),
    new WriteSvgTool(),
  ];
}
