import type { Request, Response } from "express";
import { IntegrationService } from "./integration.service.js";

/**
 * HTTP controller for integration endpoints (Gmail, etc.).
 * Each integration group gets its own set of handler methods.
 */
export class IntegrationController {
  constructor(private readonly integrationService: IntegrationService) {}

  // ─── Gmail OAuth ───────────────────────────────────────

  /** GET /api/auth/gmail — initiate OAuth, returns consent URL */
  getGmailAuthUrl = (req: Request, res: Response): void => {
    try {
      const result = this.integrationService.getGmailAuthUrl(
        req.protocol,
        req.get("host")!,
      );
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  };

  /** GET /api/auth/gmail/callback — exchange code for tokens */
  handleGmailCallback = async (req: Request, res: Response): Promise<void> => {
    const code = req.query.code as string;
    if (!code) {
      res.status(400).send("Missing authorization code");
      return;
    }

    const result = await this.integrationService.handleGmailCallback(
      code,
      req.protocol,
      req.get("host")!,
    );

    res.redirect(result.redirectUrl);
  };

  /** GET /api/auth/gmail/status — check connection status */
  getGmailStatus = async (_req: Request, res: Response): Promise<void> => {
    const status = await this.integrationService.getGmailStatus();
    res.json(status);
  };

  /** DELETE /api/auth/gmail — disconnect Gmail */
  disconnectGmail = async (_req: Request, res: Response): Promise<void> => {
    await this.integrationService.disconnectGmail();
    res.json({ disconnected: true });
  };
}
