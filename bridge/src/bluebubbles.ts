import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { config } from "./config.ts";
import { log } from "./logger.ts";

// Minimal shape of a BlueBubbles "new-message" payload — only the fields we
// actually consume. The server emits much more; ignore the rest.
export interface IncomingMessage {
  guid: string;
  text: string | null;
  isFromMe: boolean;
  handle: { address: string } | null;
  chats: { guid: string; style: number }[];
}

type Handler = (msg: IncomingMessage) => void | Promise<void>;

export function connectBlueBubbles(onMessage: Handler): Socket {
  const url = config.bbUrl;
  log.info(`connecting to BlueBubbles at ${url}`);
  const socket = io(url, {
    transports: ["websocket"],
    query: { guid: config.bbPassword },
    reconnection: true,
    reconnectionDelay: 2000,
  });

  socket.on("connect", () => log.info("socket connected", socket.id));
  socket.on("disconnect", (reason) => log.warn("socket disconnected:", reason));
  socket.on("connect_error", (err) => log.error("connect_error:", err.message));

  socket.on("new-message", async (raw: unknown) => {
    try {
      const msg = raw as IncomingMessage;
      await onMessage(msg);
    } catch (err) {
      log.error("new-message handler threw:", err);
    }
  });

  return socket;
}

// Send a single text message via the BlueBubbles REST API. Returns the new
// message GUID on success. Errors are logged and swallowed by callers that
// don't care; this function rethrows so the caller can decide.
export async function sendText(chatGuid: string, message: string): Promise<void> {
  const tempGuid = `bridge-${randomUUID()}`;
  const url = `${config.bbUrl}/api/v1/message/text?password=${encodeURIComponent(config.bbPassword)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatGuid, tempGuid, message, method: "apple-script" }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`bluebubbles send failed: ${res.status} ${body.slice(0, 200)}`);
  }
}

// Send a list of message segments sequentially with a small delay between
// each, so iMessage preserves ordering even when the server batches.
export async function sendSegments(chatGuid: string, segments: string[]): Promise<void> {
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg.trim()) continue;
    try {
      await sendText(chatGuid, seg);
    } catch (err) {
      log.error(`send segment ${i + 1}/${segments.length} failed:`, err);
    }
    if (i < segments.length - 1) await new Promise((r) => setTimeout(r, 250));
  }
}
