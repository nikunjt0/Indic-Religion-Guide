import { Suspense } from "react";
import BackLink from "@/components/BackLink";
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
  return <ChatClient chatId={id} />;
}

export default function ChatPage({ params }: PageProps<"/chats/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-6">
      <BackLink href="/chats" label="All chats" />
      <Suspense fallback={<p className="text-sm text-muted">Loading chat…</p>}>
        <ChatBody params={params} />
      </Suspense>
    </main>
  );
}
