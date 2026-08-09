// Environment safeguard for outbound messages. Real sends happen only when
// MESSAGING_SEND_ENABLED === "true". When MESSAGING_TEST_ALLOWLIST is set
// (comma-separated normalized handles), only those recipients may receive
// messages regardless of the enabled flag — the belt for non-production
// environments that still need to test against a real device.

export interface SendGuardConfig {
  sendEnabled: boolean;
  allowlist: string[] | null; // null = no allowlist restriction
}

export interface GuardDecision {
  allowed: boolean;
  reason?: "sending-disabled" | "not-on-allowlist";
}

export function guardConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): SendGuardConfig {
  const allowlistRaw = (env.MESSAGING_TEST_ALLOWLIST ?? "").trim();
  // Tolerant parse: "true"/"TRUE"/"1"/"yes", quoted or not — a stray space in
  // .env must not silently disable production sends.
  const enabledRaw = (env.MESSAGING_SEND_ENABLED ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase();
  return {
    sendEnabled: ["true", "1", "yes"].includes(enabledRaw),
    allowlist: allowlistRaw
      ? allowlistRaw.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)
      : null,
  };
}

export function checkSendAllowed(cfg: SendGuardConfig, handle: string): GuardDecision {
  if (!cfg.sendEnabled) return { allowed: false, reason: "sending-disabled" };
  if (cfg.allowlist && !cfg.allowlist.includes(handle.trim().toLowerCase())) {
    return { allowed: false, reason: "not-on-allowlist" };
  }
  return { allowed: true };
}
