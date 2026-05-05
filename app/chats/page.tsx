import { redirect } from "next/navigation";
import { Suspense } from "react";
import BackLink from "@/components/BackLink";
import { getSessionUser } from "@/lib/auth/session";
import ChatsList from "./chats-list";

export const metadata = {
  title: "Chat history — Indic Religion Guide",
};

async function ChatsBody() {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in?next=%2Fchats");
  return <ChatsList uid={user.uid} />;
}

export default function ChatsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
      <BackLink href="/" label="Back to home" />
      <header className="flex items-start justify-between gap-4 rounded-2xl border border-border-warm bg-surface/80 p-6">
        <div>
          <h1 className="font-display text-3xl font-semibold text-maroon">
            Your chats
          </h1>
          <p className="mt-1 text-sm leading-relaxed text-foreground/75">
            Previous conversations are saved so you can pick up where you left
            off.
          </p>
        </div>
      </header>
      <Suspense fallback={<p className="text-sm text-muted">Loading your chats…</p>}>
        <ChatsBody />
      </Suspense>
    </main>
  );
}
