import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { ChatService } from "./chat.service.js";

function safeJson(res: Response, body: unknown): void {
  if (res.writableEnded || res.headersSent) return;
  try {
    res.json(body);
  } catch {
    // Client disconnected before response could be sent
  }
}

/**
 * HTTP controller for chat endpoints.
 * Translates HTTP request/response into service calls.
 */
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /** POST /api/chat */
  handleChat = async (req: Request, res: Response): Promise<void> => {
    const { message, sessionId, runId: bodyRunId } = req.body;

    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Missing message" });
      return;
    }

    // Accept sessionId from client, fallback to web-session
    const sid =
      typeof sessionId === "string" && sessionId.length > 0
        ? sessionId
        : "web-session";

    const runId =
      typeof bodyRunId === "string" && bodyRunId.length > 0 ? bodyRunId : randomUUID();

    const ac = new AbortController();
    /** `req` "close" can fire after body read; abort only if the response never finished (real disconnect). */
    res.once("close", () => {
      if (!res.writableEnded) ac.abort();
    });

    try {
      const result = await this.chatService.handleMessage(sid, message, runId, ac.signal);
      safeJson(res, result);
    } catch (e) {
      if (!res.writableEnded && !res.headersSent) {
        try {
          res.status(500).json({ error: String(e) });
        } catch {
          // Client gone
        }
      }
    }
  };

  /** POST /api/chat/cancel — abort an in-flight run by runId */
  handleCancelChat = async (req: Request, res: Response): Promise<void> => {
    const { runId } = req.body as { runId?: string };
    if (!runId || typeof runId !== "string") {
      res.status(400).json({ error: "Missing runId" });
      return;
    }
    const cancelled = this.chatService.cancelRun(runId);
    res.json({ ok: cancelled, found: cancelled });
  };
}
