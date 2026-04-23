import { adminDb } from "../firebase/admin";
import type { QueryLog } from "../types/firestore";

export async function logQuery(entry: Omit<QueryLog, "id" | "createdAt">): Promise<string> {
  const ref = adminDb.collection("queries").doc();
  const now = Date.now();
  await ref.set({ ...entry, id: ref.id, createdAt: now });
  return ref.id;
}
