import {
  getDownloadURL,
  getStorage,
  ref,
  type FirebaseStorage,
  uploadString,
} from "firebase/storage";
import type { ChatAttachment } from "@/lib/mediaAttachments";
import type { ChatMessageMedia } from "@/lib/types/firestore";
import { getClientApp } from "./client";

export function getClientStorage(): FirebaseStorage {
  return getStorage(getClientApp());
}

// Persist a turn's attachments to Cloud Storage so the chat history can
// re-render them later. The data URLs themselves are never written to
// Firestore (a few would blow past the 1MB document limit); we store only the
// resulting download URLs. The `mediaId` namespaces one turn's files; it does
// not need to match the chat id, which keeps uploads independent of chat
// creation timing.
export async function uploadAttachments(
  uid: string,
  mediaId: string,
  attachments: ChatAttachment[],
): Promise<ChatMessageMedia[]> {
  const storage = getClientStorage();

  const uploads = attachments.map(async (a, i) => {
    const path = `users/${uid}/chat-media/${mediaId}/${i}.jpg`;
    const fileRef = ref(storage, path);
    // Attachments are already JPEG data URLs produced by the client pipeline.
    await uploadString(fileRef, a.dataUrl, "data_url", {
      contentType: "image/jpeg",
    });
    const url = await getDownloadURL(fileRef);
    const media: ChatMessageMedia = {
      kind: a.kind,
      url,
      sourceName: a.sourceName,
    };
    if (a.frameIndex !== undefined) media.frameIndex = a.frameIndex;
    if (a.frameTotal !== undefined) media.frameTotal = a.frameTotal;
    return media;
  });

  return Promise.all(uploads);
}
