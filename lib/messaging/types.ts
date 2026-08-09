// Provider-agnostic messaging layer. Program/scheduling code depends only on
// these types; BlueBubbles specifics live in bluebubbles.ts. A Twilio/WhatsApp
// adapter can be added later by implementing MessagingProvider.

export type SendErrorCategory =
  | "timeout"
  | "network"
  | "server" // provider 5xx / transient
  | "auth"
  | "invalid-recipient"
  | "rate-limited"
  | "blocked" // guard refused (send disabled / not on allowlist)
  | "unknown";

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  providerChatId?: string;
  sentAt?: number;
  errorCategory?: SendErrorCategory;
  /** Whether the queue should retry this failure. */
  retryable?: boolean;
  errorMessage?: string;
  rawStatus?: number;
}

export interface Recipient {
  /** Normalized handle (+E.164 phone or lowercased Apple-ID email). */
  handle: string;
  /** Provider chat identifier when already known (BlueBubbles chatGuid). */
  chatGuid?: string;
}

export interface InboundAttachmentRef {
  id: string;
  mimeType: string | null;
  filename: string | null;
  totalBytes?: number;
}

export interface InboundEvent {
  /** Provider-unique event/message id — used for deduplication. */
  providerEventId: string;
  handle: string; // normalized sender handle
  chatId?: string;
  text: string;
  isFromMe: boolean;
  isGroupChat: boolean;
  attachments: InboundAttachmentRef[];
  receivedAt: number;
}

export interface HealthCheckResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export interface MessagingProvider {
  readonly name: string;
  sendTextMessage(recipient: Recipient, message: string): Promise<SendResult>;
  /** Normalize a raw address into the canonical handle form. */
  normalizeRecipient(raw: string): string;
  healthCheck(): Promise<HealthCheckResult>;
  /**
   * Parse a raw provider event into an InboundEvent, or null when the event
   * is not a processable 1:1 inbound message (malformed, group chat, etc.).
   * isFromMe events are returned (not null) so callers can log-and-ignore.
   */
  parseInboundEvent(raw: unknown): InboundEvent | null;
}
