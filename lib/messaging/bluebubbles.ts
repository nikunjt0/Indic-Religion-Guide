import { randomUUID, createHash } from "node:crypto";
import type {
  HealthCheckResult,
  InboundEvent,
  MessagingProvider,
  Recipient,
  SendErrorCategory,
  SendResult,
} from "./types";

// BlueBubbles REST provider. Endpoint paths and the password-query-param auth
// match the BlueBubbles server API already in production use by the bridge
// (bridge/src/bluebubbles.ts). The password is the documented auth mechanism;
// we never log full URLs anywhere in this module.

export interface BlueBubblesConfig {
  baseUrl: string; // e.g. http://localhost:1234
  password: string;
  /** Per-request timeout in ms. */
  requestTimeoutMs?: number;
  /** Bounded in-call retries for transient failures (network/5xx/timeout). */
  maxTransientRetries?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_TRANSIENT_RETRIES = 2;

export function normalizeHandle(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.includes("@")) return trimmed.toLowerCase();
  const digits = trimmed.replace(/[^\d+]/g, "");
  if (!digits) return trimmed.toLowerCase();
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

/** 24-char sha1 prefix — stable opaque user id derived from the handle. */
export function handleIdFor(normalized: string): string {
  return createHash("sha1").update(normalized).digest("hex").slice(0, 24);
}

function categorize(status: number): { category: SendErrorCategory; retryable: boolean } {
  if (status === 401 || status === 403) return { category: "auth", retryable: false };
  if (status === 404 || status === 400) return { category: "invalid-recipient", retryable: false };
  if (status === 429) return { category: "rate-limited", retryable: true };
  if (status >= 500) return { category: "server", retryable: true };
  return { category: "unknown", retryable: false };
}

interface RawBBMessage {
  guid?: string;
  text?: string | null;
  isFromMe?: boolean;
  handle?: { address?: string } | null;
  chats?: { guid: string; style: number }[];
  attachments?: {
    guid?: string;
    mimeType?: string | null;
    transferName?: string | null;
    totalBytes?: number;
  }[];
}

export class BlueBubblesMessagingProvider implements MessagingProvider {
  readonly name = "bluebubbles";
  private readonly cfg: Required<BlueBubblesConfig>;

  constructor(cfg: BlueBubblesConfig) {
    this.cfg = {
      requestTimeoutMs: DEFAULT_TIMEOUT_MS,
      maxTransientRetries: DEFAULT_TRANSIENT_RETRIES,
      ...cfg,
      baseUrl: cfg.baseUrl.replace(/\/$/, ""),
    };
  }

  normalizeRecipient(raw: string): string {
    return normalizeHandle(raw);
  }

  private url(path: string): string {
    const sep = path.includes("?") ? "&" : "?";
    return `${this.cfg.baseUrl}${path}${sep}password=${encodeURIComponent(this.cfg.password)}`;
  }

  private async fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    return fetch(url, { ...init, signal: AbortSignal.timeout(this.cfg.requestTimeoutMs) });
  }

  async sendTextMessage(recipient: Recipient, message: string): Promise<SendResult> {
    // BlueBubbles addresses an existing chat by GUID. For handles without a
    // known chat, "iMessage;-;<handle>" is the conventional 1:1 chat GUID.
    const chatGuid = recipient.chatGuid ?? `iMessage;-;${recipient.handle}`;
    const tempGuid = `companion-${randomUUID()}`;
    const body = JSON.stringify({ chatGuid, tempGuid, message, method: "apple-script" });

    let lastError: SendResult | null = null;
    for (let attempt = 0; attempt <= this.cfg.maxTransientRetries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt));
      try {
        const res = await this.fetchWithTimeout(this.url("/api/v1/message/text"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        if (res.ok) {
          let providerMessageId: string | undefined;
          try {
            const json = (await res.json()) as { data?: { guid?: string } };
            providerMessageId = json?.data?.guid;
          } catch {
            // Response body is informational only; a 2xx is still a success.
          }
          return {
            ok: true,
            providerMessageId: providerMessageId ?? tempGuid,
            providerChatId: chatGuid,
            sentAt: Date.now(),
            rawStatus: res.status,
          };
        }
        const detail = (await res.text().catch(() => "")).slice(0, 200);
        const { category, retryable } = categorize(res.status);
        lastError = {
          ok: false,
          errorCategory: category,
          retryable,
          errorMessage: `HTTP ${res.status}: ${detail}`,
          rawStatus: res.status,
        };
        if (!retryable) return lastError;
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === "TimeoutError";
        lastError = {
          ok: false,
          errorCategory: isTimeout ? "timeout" : "network",
          retryable: true,
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
    }
    return lastError ?? { ok: false, errorCategory: "unknown", retryable: false };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const started = Date.now();
    try {
      const res = await this.fetchWithTimeout(this.url("/api/v1/server/info"));
      if (!res.ok) return { ok: false, latencyMs: Date.now() - started, error: `HTTP ${res.status}` };
      return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  parseInboundEvent(raw: unknown): InboundEvent | null {
    if (!raw || typeof raw !== "object") return null;
    const msg = raw as RawBBMessage;
    if (!msg.guid) return null;
    const address = msg.handle?.address;
    if (!address) return null;
    const chat = msg.chats?.[0];
    return {
      providerEventId: msg.guid,
      handle: normalizeHandle(address),
      chatId: chat?.guid,
      text: (msg.text ?? "").trim(),
      isFromMe: msg.isFromMe === true,
      // BlueBubbles chat style: 45 = 1:1 direct, 43 = group.
      isGroupChat: chat ? chat.style !== 45 : false,
      attachments: (msg.attachments ?? [])
        .filter((a) => a.guid)
        .map((a) => ({
          id: a.guid as string,
          mimeType: a.mimeType ?? null,
          filename: a.transferName ?? null,
          totalBytes: a.totalBytes,
        })),
      receivedAt: Date.now(),
    };
  }
}
