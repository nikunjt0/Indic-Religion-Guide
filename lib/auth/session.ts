import { cookies } from "next/headers";
import { adminAuth } from "../firebase/admin";

const SESSION_COOKIE = "__session";

export async function getSessionUser() {
  const store = await cookies();
  const cookie = store.get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  try {
    const decoded = await adminAuth.verifySessionCookie(cookie, true);
    return decoded;
  } catch {
    return null;
  }
}

export { SESSION_COOKIE };
