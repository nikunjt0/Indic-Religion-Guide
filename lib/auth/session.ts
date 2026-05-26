import { cookies } from "next/headers";
import { adminAuth } from "../firebase/admin";

const SESSION_COOKIE = "__session";

// Lowercased admin email allowlist. Public users go through the iMessage bridge
// (text GURU); the web is admin-only for ops, debugging, and content review.
function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function getSessionUser() {
  const store = await cookies();
  const cookie = store.get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  try {
    const decoded = await adminAuth.verifySessionCookie(cookie, true);
    const allowed = adminEmails();
    const email = decoded.email?.toLowerCase();
    // Empty allowlist means "lockdown not configured" — treat as nobody allowed
    // rather than silently falling open.
    if (!email || allowed.size === 0 || !allowed.has(email)) return null;
    return decoded;
  } catch {
    return null;
  }
}

export { SESSION_COOKIE };
