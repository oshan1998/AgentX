import type { Request, Response } from "express";
import type { WorkspaceService } from "./workspace.service.js";

export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  /** POST /api/session/:id/files — multipart field `file`, optional `path` */
  uploadFile = async (
    req: Request<{ id: string }>,
    res: Response,
  ): Promise<void> => {
    const sessionId = req.params.id;
    if (!sessionId?.trim()) {
      res.status(400).json({ error: "Missing session id" });
      return;
    }

    const file = req.file;
    if (!file?.buffer?.length) {
      res.status(400).json({ error: "Missing file (multipart field: file)" });
      return;
    }

    const relativePath =
      typeof req.body?.path === "string" ? req.body.path : undefined;

    try {
      const saved = await this.workspaceService.uploadFile(
        sessionId,
        file.buffer,
        file.originalname,
        relativePath,
      );
      res.json({ file: saved });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(400).json({ error: message });
    }
  };

  /** GET /api/session/:id/files */
  listFiles = async (
    req: Request<{ id: string }>,
    res: Response,
  ): Promise<void> => {
    const sessionId = req.params.id;
    if (!sessionId?.trim()) {
      res.status(400).json({ error: "Missing session id" });
      return;
    }

    try {
      const files = await this.workspaceService.listUploads(sessionId);
      res.json({ files });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  };
}
