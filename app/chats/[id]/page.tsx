import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth/session";
import ChatClient from "./chat-client";

export const metadata = {
  title: "Chat — Indic Religion Guide",
};

async function ChatBody({
  params,
}: {
  params: PageProps<"/chats/[id]">["params"];
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/chats/${id}`)}`);
  return <ChatClient chatId={id} uid={user.uid} />;
}

export default function ChatPage({ params }: PageProps<"/chats/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-3xl px-5 py-6">
          <p className="text-sm text-muted">Loading chat…</p>
        </div>
      }
    >
      <ChatBody params={params} />
    </Suspense>
  );
}
