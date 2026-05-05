import { redirect } from "next/navigation";
import { Suspense } from "react";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionUser } from "@/lib/auth/session";
import type { UserProfile } from "@/lib/types/firestore";
import AskClient from "./ask-client";

export const metadata = {
  title: "Ask — Indic Religion Guide",
};

// The session/profile lookup is dynamic; Cache Components requires it to live
// inside an explicit Suspense boundary or the build fails the blocking-route
// check. Boundary is tight so the rest of the page can prerender.
async function AskGate() {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in?next=%2Fask");
  const snap = await adminDb.collection("users").doc(user.uid).get();
  const profile = snap.exists ? (snap.data() as UserProfile) : null;
  const hasTradition =
    (profile?.traditions && profile.traditions.length > 0) ||
    Boolean(profile?.traditionPreference);
  // Force the user to pick a tradition before they can ask. The choice drives
  // retrieval filtering and prompt framing — an unset profile would silently
  // fall back to "all sources", which isn't what the user signed up for.
  if (!hasTradition) redirect("/profile");
  return <AskClient uid={user.uid} />;
}

export default function AskPage() {
  return (
    <Suspense fallback={null}>
      <AskGate />
    </Suspense>
  );
}
