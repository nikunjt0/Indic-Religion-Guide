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
  attachments?: BlueBubblesAttachment[];
}

type Handler = (msg: IncomingMessage) => void | Promise<void>;

export interface BlueBubblesAttachment {
  guid?: string;
  mimeType?: string;
  uti?: string;
  transferName?: string;
  name?: string;
  filename?: string;
  originalFilename?: string;
  totalBytes?: number;
}

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

function apiUrl(path: string, params: Record<string, string> = {}): string {
  const url = new URL(`${config.bbUrl}${path}`);
  url.searchParams.set("password", config.bbPassword);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function extractAttachments(value: unknown): BlueBubblesAttachment[] {
  if (!value || typeof value !== "object") return [];
  const attachments = (value as { attachments?: unknown }).attachments;
  if (!Array.isArray(attachments)) return [];
  return attachments.filter(
    (a): a is BlueBubblesAttachment => !!a && typeof a === "object",
  );
}

async function fetchMessageAttachments(messageGuid: string): Promise<BlueBubblesAttachment[]> {
  const res = await fetch(apiUrl(`/api/v1/message/${encodeURIComponent(messageGuid)}`));
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`bluebubbles message fetch failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const body = (await res.json()) as unknown;
  const wrapped = body as { data?: unknown };
  return extractAttachments(wrapped.data ?? body);
}

// BlueBubbles can emit `new-message` before attachment metadata is indexed.
// Poll briefly so photo-only/video-only texts are not dropped as empty turns.
export async function listMessageAttachments(
  msg: IncomingMessage,
): Promise<BlueBubblesAttachment[]> {
  const fromPayload = extractAttachments(msg);
  if (fromPayload.length > 0) return fromPayload;

  const delays = [0, 750, 1500];
  let lastError: unknown;
  for (const delay of delays) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      const attachments = await fetchMessageAttachments(msg.guid);
      if (attachments.length > 0) return attachments;
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) log.warn("attachment metadata lookup failed:", lastError);
  return [];
}

export async function downloadAttachment(
  attachment: BlueBubblesAttachment,
): Promise<{ bytes: Buffer; contentType: string; filename: string }> {
  const guid = attachment.guid?.trim();
  if (!guid) throw new Error("BlueBubbles attachment missing guid");

  const filename =
    attachment.transferName ??
    attachment.originalFilename ??
    attachment.filename ??
    attachment.name ??
    `${guid}`;
  const res = await fetch(
    apiUrl(`/api/v1/attachment/${encodeURIComponent(guid)}/download`, {
      force: "true",
    }),
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`bluebubbles attachment download failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const contentType =
    res.headers.get("content-type") ??
    attachment.mimeType ??
    mimeTypeFromFilename(filename) ??
    "application/octet-stream";
  const bytes = Buffer.from(await res.arrayBuffer());
  return { bytes, contentType, filename };
}

function mimeTypeFromFilename(filename: string): string | undefined {
  const ext = filename.toLowerCase().split(".").pop();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "heic":
    case "heif":
      return "image/heic";
    case "mov":
      return "video/quicktime";
    case "mp4":
      return "video/mp4";
    case "m4v":
      return "video/x-m4v";
    default:
      return undefined;
  }
}
