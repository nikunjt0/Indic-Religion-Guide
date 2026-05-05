"use client";

import { signOut } from "firebase/auth";
import { getClientAuth } from "../firebase/client";

export async function logOut(): Promise<void> {
  await signOut(getClientAuth());
  await fetch("/api/session", { method: "DELETE" });
  // Hard reload to wipe Next.js' client-side router cache. Without this the
  // user can navigate back to /profile (or any visited route) and see the
  // previous user's RSC payload, even though the session cookie is gone.
  window.location.assign("/");
}
