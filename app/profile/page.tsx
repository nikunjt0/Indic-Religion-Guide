import { redirect } from "next/navigation";
import { Suspense } from "react";
import BackLink from "@/components/BackLink";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionUser } from "@/lib/auth/session";
import type { UserProfile } from "@/lib/types/firestore";
import ProfileForm from "./profile-form";

export const metadata = {
  title: "Your profile — Indic Religion Guide",
};

async function ProfileBody() {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");

  const snap = await adminDb.collection("users").doc(user.uid).get();
  const existing = snap.exists ? (snap.data() as UserProfile) : null;

  return (
    <ProfileForm
      uid={user.uid}
      email={user.email ?? null}
      initial={existing}
    />
  );
}

export default function ProfilePage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8">
      <BackLink href="/" label="Back to home" />
      <header className="flex flex-col gap-2 rounded-2xl border border-border-warm bg-surface/80 p-6">
        <h1 className="font-display text-3xl font-semibold text-maroon">
          Your profile
        </h1>
        <p className="text-sm leading-relaxed text-foreground/75">
          Your surname, region, and sect personalize ritual variants only. They
          never determine authority.
        </p>
      </header>
      <section className="rounded-2xl border border-border-warm bg-surface p-6 shadow-sm">
        <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
          <ProfileBody />
        </Suspense>
      </section>
    </main>
  );
}
