import type { Server as HttpServer } from "node:http";
import type { RawData } from "ws";
import { WebSocketServer, WebSocket } from "ws";
import { logger } from "../services/logger.js";
import { parseClientMessage, sendJson, type ClientMessage } from "./ws-protocol.js";

const WS_PATH = "/ws";

function rawToString(data: RawData): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

function dispatch(socket: WebSocket, message: ClientMessage): void {
  switch (message.type) {
    case "hello": {
      logger.debug("WebSocket hello", { clientVersion: message.payload?.clientVersion });
      sendJson(socket, {
        type: "welcome",
        payload: { serverTime: new Date().toISOString() },
      });
      break;
    }
    case "ping": {
      sendJson(socket, {
        type: "pong",
        payload: { t: message.payload?.t ?? Date.now() },
      });
      break;
    }
    default: {
      const _exhaustive: never = message;
      void _exhaustive;
    }
  }
}

/**
 * Attach a WebSocket server to the same HTTP server as Express (path `/ws`).
 */
export function attachWebSocketGateway(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });

  wss.on("connection", (socket: WebSocket, req) => {
    const ip = req.socket.remoteAddress ?? "unknown";
    logger.info("WebSocket client connected", { ip });

    socket.on("message", (data: RawData) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawToString(data));
      } catch {
        sendJson(socket, { type: "error", payload: { code: "INVALID_JSON" } });
        return;
      }

      const message = parseClientMessage(parsed);
      if (!message) {
        sendJson(socket, { type: "error", payload: { code: "UNKNOWN_TYPE" } });
        return;
      }

      try {
        dispatch(socket, message);
      } catch (err) {
        logger.error("WebSocket handler error", { err });
        sendJson(socket, {
          type: "error",
          payload: { code: "HANDLER_ERROR", message: err instanceof Error ? err.message : String(err) },
        });
      }
    });

    socket.on("close", (code, reason) => {
      logger.info("WebSocket client disconnected", {
        ip,
        code,
        reason: reason.toString(),
      });
    });

    socket.on("error", (err) => {
      logger.warn("WebSocket socket error", { ip, err });
    });
  });

  wss.on("error", (err) => {
    logger.error("WebSocketServer error", { err });
  });

  return wss;
}
