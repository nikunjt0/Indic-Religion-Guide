"use client";

import { signOut } from "firebase/auth";
import { getClientAuth } from "../firebase/client";

export async function logOut(): Promise<void> {
  await signOut(getClientAuth());
  await fetch("/api/session", { method: "DELETE" });
}
