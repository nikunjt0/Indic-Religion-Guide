import { createHmac, timingSafeEqual } from "node:crypto";

// Stripe webhook signature verification (the documented v1 scheme), done with
// node:crypto so the Next route doesn't need the Stripe SDK. The header looks
// like: "t=1699999999,v1=abc...,v1=def...".

const DEFAULT_TOLERANCE_SEC = 5 * 60;

export function verifyStripeSignature(
  payload: string,
  signatureHeader: string | null | undefined,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
  toleranceSec: number = DEFAULT_TOLERANCE_SEC
): boolean {
  if (!signatureHeader) return false;
  const parts = signatureHeader.split(",").map((p) => p.trim());
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
  const signatures = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!timestamp || signatures.length === 0) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > toleranceSec) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  return signatures.some((sig) => {
    const sigBuf = Buffer.from(sig, "utf8");
    return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
  });
}
