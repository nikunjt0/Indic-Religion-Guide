import { createHash } from "node:crypto";

// Normalize a BlueBubbles "address" / handle into a stable form. Phone-like
// strings collapse to E.164-ish digits with a leading '+'. Email-like strings
// (iMessage Apple-ID handles) lowercase.
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

// 24-char sha1 prefix — stable, URL-safe, opaque. Raw handle is kept in the
// Firestore doc separately so ops can still find a user by phone if needed.
export function handleIdFor(normalized: string): string {
  return createHash("sha1").update(normalized).digest("hex").slice(0, 24);
}
