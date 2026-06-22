import type { Tool } from "../../common/interfaces/types.js";
import { AddImageOverlayTool } from "./tools/add-image-overlay.tool.js";
import { ApplyImageTransformTool } from "./tools/apply-image-transform.tool.js";
import { ComposeLayersTool } from "./tools/compose-layers.tool.js";
import { CropAndResizeTool } from "./tools/crop-and-resize.tool.js";
import { DetectImageRegionTool } from "./tools/detect-image-region.tool.js";
import { DownloadImageTool } from "./tools/download-image.tool.js";
import { EditImageTool } from "./tools/edit-image.tool.js";
import { ExportMultiSizeTool } from "./tools/export-multi-size.tool.js";
import { GenerateImageTool } from "./tools/generate-image.tool.js";
import { InspectImageTool } from "./tools/inspect-image.tool.js";
import { ReadImageMetadataTool } from "./tools/read-image-metadata.tool.js";
import { RemoveBackgroundTool } from "./tools/remove-background.tool.js";
import { RenderHtmlToPngTool } from "./tools/render-html-to-png.tool.js";
import { RenderSvgToPngTool } from "./tools/render-svg-to-png.tool.js";
import { WriteSvgTool } from "./tools/write-svg.tool.js";
import { ReadPdfTool } from "./tools/read-pdf.tool.js";
import { GenerateDesignedPdfTool } from "./tools/generate-designed-pdf.tool.js";

/** Static manifest of design MCP tools (bundle-friendly). */
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
    new GenerateDesignedPdfTool(),
    new InspectImageTool(),
    new ReadImageMetadataTool(),
    new ReadPdfTool(),
    new RemoveBackgroundTool(),
    new RenderHtmlToPngTool(),
    new RenderSvgToPngTool(),
    new WriteSvgTool(),
  ];
}
