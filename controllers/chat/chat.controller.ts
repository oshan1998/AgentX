import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { ChatService } from "./chat.service.js";

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

    try {
      const result = await this.chatService.handleMessage(sid, message, runId);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  };
}
