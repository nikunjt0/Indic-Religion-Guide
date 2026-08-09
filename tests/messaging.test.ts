import { describe, expect, it } from "vitest";
import { BlueBubblesMessagingProvider, normalizeHandle } from "../lib/messaging/bluebubbles";
import { checkSendAllowed, guardConfigFromEnv } from "../lib/messaging/guard";

describe("normalizeHandle", () => {
  it("normalizes phones to E.164-ish", () => {
    expect(normalizeHandle("(312) 555-0100")).toBe("+13125550100");
    expect(normalizeHandle("+91 98765 43210")).toBe("+919876543210");
  });
  it("lowercases Apple-ID emails", () => {
    expect(normalizeHandle(" Some.One@ICloud.com ")).toBe("some.one@icloud.com");
  });
});

describe("parseInboundEvent", () => {
  const provider = new BlueBubblesMessagingProvider({ baseUrl: "http://x", password: "p" });

  it("parses a 1:1 inbound message", () => {
    const ev = provider.parseInboundEvent({
      guid: "m1",
      text: "hello",
      isFromMe: false,
      handle: { address: "(312) 555-0100" },
      chats: [{ guid: "iMessage;-;+13125550100", style: 45 }],
      attachments: [{ guid: "a1", mimeType: "image/jpeg", transferName: "x.jpg" }],
    });
    expect(ev).toMatchObject({
      providerEventId: "m1",
      handle: "+13125550100",
      text: "hello",
      isFromMe: false,
      isGroupChat: false,
    });
    expect(ev!.attachments).toHaveLength(1);
  });

  it("marks group chats", () => {
    const ev = provider.parseInboundEvent({
      guid: "m2",
      text: "hi all",
      isFromMe: false,
      handle: { address: "+13125550100" },
      chats: [{ guid: "g", style: 43 }],
    });
    expect(ev!.isGroupChat).toBe(true);
  });

  it("keeps isFromMe events parseable so callers can log-and-ignore", () => {
    const ev = provider.parseInboundEvent({
      guid: "m3",
      text: "me",
      isFromMe: true,
      handle: { address: "+13125550100" },
      chats: [{ guid: "c", style: 45 }],
    });
    expect(ev!.isFromMe).toBe(true);
  });

  it("rejects malformed payloads", () => {
    expect(provider.parseInboundEvent(null)).toBeNull();
    expect(provider.parseInboundEvent({})).toBeNull();
    expect(provider.parseInboundEvent({ guid: "x", handle: null, chats: [] })).toBeNull();
  });
});

describe("send guard", () => {
  it("blocks when sending disabled", () => {
    expect(
      checkSendAllowed({ sendEnabled: false, allowlist: null }, "+13125550100").allowed
    ).toBe(false);
  });
  it("enforces the allowlist when present", () => {
    const cfg = { sendEnabled: true, allowlist: ["+13125550100"] };
    expect(checkSendAllowed(cfg, "+13125550100").allowed).toBe(true);
    expect(checkSendAllowed(cfg, "+19998887777")).toEqual({
      allowed: false,
      reason: "not-on-allowlist",
    });
  });
  it("allows freely when enabled with no allowlist", () => {
    expect(checkSendAllowed({ sendEnabled: true, allowlist: null }, "+1").allowed).toBe(true);
  });
  it("parses env config", () => {
    const cfg = guardConfigFromEnv({
      MESSAGING_SEND_ENABLED: "true",
      MESSAGING_TEST_ALLOWLIST: "+13125550100, someone@icloud.com",
    });
    expect(cfg.sendEnabled).toBe(true);
    expect(cfg.allowlist).toEqual(["+13125550100", "someone@icloud.com"]);
    const off = guardConfigFromEnv({});
    expect(off.sendEnabled).toBe(false);
    expect(off.allowlist).toBeNull();
  });
});
