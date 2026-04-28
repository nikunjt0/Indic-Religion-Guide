import { Suspense } from "react";
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
