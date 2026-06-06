import type { Request, Response } from "express";
import type { CorpusService } from "../../common/services/corpus.service.js";

export class CorpusController {
  constructor(private readonly corpusService: CorpusService) {}

  /** POST /api/corpus/documents — multipart field `file`, optional `displayName` */
  uploadDocument = async (req: Request, res: Response): Promise<void> => {
    const file = req.file;
    if (!file?.buffer?.length) {
      res.status(400).json({ error: "Missing file (multipart field: file)" });
      return;
    }

    const displayName =
      typeof req.body?.displayName === "string" ? req.body.displayName : undefined;

    try {
      const document = await this.corpusService.uploadAndIndex(
        file.buffer,
        file.originalname,
        displayName,
      );
      res.status(201).json({ document });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(400).json({ error: message });
    }
  };

  /** GET /api/corpus/documents */
  listDocuments = async (_req: Request, res: Response): Promise<void> => {
    try {
      const documents = await this.corpusService.listDocuments();
      res.json({ documents });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  };
}
