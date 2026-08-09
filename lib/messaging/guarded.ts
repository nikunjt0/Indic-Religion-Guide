import type { MessagingProvider, Recipient, SendResult } from "./types";
import { checkSendAllowed, type SendGuardConfig } from "./guard";

// Wraps any provider with the environment send-guard. All production code
// should send through a GuardedMessagingProvider, never a raw provider, so a
// misconfigured dev environment cannot text real users.

export class GuardedMessagingProvider implements MessagingProvider {
  constructor(
    private readonly inner: MessagingProvider,
    private readonly guard: SendGuardConfig,
    private readonly onBlocked?: (recipient: Recipient, reason: string) => void
  ) {}

  get name(): string {
    return this.inner.name;
  }

  async sendTextMessage(recipient: Recipient, message: string): Promise<SendResult> {
    const decision = checkSendAllowed(this.guard, recipient.handle);
    if (!decision.allowed) {
      this.onBlocked?.(recipient, decision.reason ?? "blocked");
      return {
        ok: false,
        errorCategory: "blocked",
        retryable: false,
        errorMessage: `send blocked: ${decision.reason}`,
      };
    }
    return this.inner.sendTextMessage(recipient, message);
  }

  normalizeRecipient(raw: string): string {
    return this.inner.normalizeRecipient(raw);
  }

  healthCheck() {
    return this.inner.healthCheck();
  }

  parseInboundEvent(raw: unknown) {
    return this.inner.parseInboundEvent(raw);
  }
}
