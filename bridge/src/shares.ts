import { randomBytes } from "node:crypto";
import { config } from "./config.ts";
import { adminDb } from "./firestore.ts";
import type {
  MatchedGuideRef,
  SourceGroup,
} from "../../lib/types/firestore.ts";

export interface ShareDoc {
  shortId: string;
  question: string;
  answer: string;
  sources: SourceGroup[];
  matchedGuides: MatchedGuideRef[];
  createdAt: number;
}

// 6 random bytes → 8 url-safe chars. ~2.8e14 keyspace; plenty for our scale
// and short enough to read aloud over the phone if needed.
function shortId(): string {
  return randomBytes(6).toString("base64url");
}

export async function createShare(args: {
  question: string;
  answer: string;
  sources: SourceGroup[];
  matchedGuides: MatchedGuideRef[];
}): Promise<{ shortId: string; url: string } | null> {
  if (!config.appPublicUrl) return null;
  const id = shortId();
  const doc: ShareDoc = {
    shortId: id,
    question: args.question,
    answer: args.answer,
    sources: args.sources,
    matchedGuides: args.matchedGuides,
    createdAt: Date.now(),
  };
  await adminDb.collection("shares").doc(id).set(doc);
  return { shortId: id, url: `${config.appPublicUrl}/q/${id}` };
}
