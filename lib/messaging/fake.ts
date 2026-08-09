import type {
  HealthCheckResult,
  InboundEvent,
  MessagingProvider,
  Recipient,
  SendResult,
} from "./types";

// In-memory provider for tests and local development. Records every send;
// failures can be scripted per-call via failNext().

export interface RecordedSend {
  recipient: Recipient;
  message: string;
  at: number;
}

export class FakeMessagingProvider implements MessagingProvider {
  readonly name = "fake";
  readonly sent: RecordedSend[] = [];
  private queuedFailures: SendResult[] = [];
  private counter = 0;

  /** Queue a failure result returned by the next sendTextMessage call. */
  failNext(result: Partial<SendResult> & { errorCategory: SendResult["errorCategory"] }): void {
    this.queuedFailures.push({ ok: false, retryable: true, ...result });
  }

  async sendTextMessage(recipient: Recipient, message: string): Promise<SendResult> {
    const failure = this.queuedFailures.shift();
    if (failure) return failure;
    this.sent.push({ recipient, message, at: Date.now() });
    this.counter += 1;
    return {
      ok: true,
      providerMessageId: `fake-${this.counter}`,
      providerChatId: recipient.chatGuid ?? `fake-chat-${recipient.handle}`,
      sentAt: Date.now(),
    };
  }

  normalizeRecipient(raw: string): string {
    return raw.trim().toLowerCase();
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return { ok: true, latencyMs: 0 };
  }

  parseInboundEvent(raw: unknown): InboundEvent | null {
    if (!raw || typeof raw !== "object") return null;
    return raw as InboundEvent;
  }
}
