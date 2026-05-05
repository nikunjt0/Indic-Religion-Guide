import { cookies } from "next/headers";
import { adminAuth } from "@/lib/firebase/admin";
import { SESSION_COOKIE } from "@/lib/auth/session";

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

export async function POST(req: Request) {
  const { idToken } = await req.json();
  if (typeof idToken !== "string") {
    return Response.json({ error: "idToken required" }, { status: 400 });
  }
  let cookie: string;
  try {
    cookie = await adminAuth.createSessionCookie(idToken, {
      expiresIn: FIVE_DAYS_MS,
    });
  } catch (err) {
    // Most common cause: FIREBASE_* env vars missing on the server, or the
    // ID token is from a different project. Without surfacing this we'd just
    // see a silent "always redirect to sign-in" loop on protected routes.
    console.error("createSessionCookie failed", err);
    return Response.json(
      { error: (err as Error).message ?? "session cookie failed" },
      { status: 500 },
    );
  }
  const store = await cookies();
  store.set(SESSION_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: FIVE_DAYS_MS / 1000,
    path: "/",
  });
  return Response.json({ ok: true });
}

export async function DELETE() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
