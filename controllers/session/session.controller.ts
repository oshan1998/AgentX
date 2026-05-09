import type { Request, Response } from "express";
import { SessionService } from "./session.service.js";

/**
 * HTTP controller for session endpoints.
 * Handles listing, creating, and fetching session history.
 */
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  /** GET /api/sessions */
  listSessions = async (_req: Request, res: Response): Promise<void> => {
    try {
      const sessions = await this.sessionService.listSessions();
      res.json({ sessions });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  };

  /** POST /api/sessions */
  createSession = async (_req: Request, res: Response): Promise<void> => {
    try {
      const session = await this.sessionService.createSession();
      res.json(session);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  };

  /** GET /api/session/:id */
  getSessionHistory = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const sessionId = req.params.id;
    try {
      const session = await this.sessionService.getSessionHistory(sessionId);
      res.json(session);
    } catch (e) {
      res.status(404).json({ error: "Session not found" });
    }
  };

  /** GET /api/session/:id/plan */
  getSessionPlan = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const sessionId = req.params.id;
    try {
      const plan = await this.sessionService.getSessionPlan(sessionId);
      if (!plan) {
        res.status(404).json({ error: "Plan not found" });
        return;
      }
      res.json(plan);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  };
}
