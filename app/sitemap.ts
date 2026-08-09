import type { MetadataRoute } from "next";
import { adminDb } from "@/lib/firebase/admin";
import type { PublicAnswer } from "@/lib/types/companion";

const BASE_URL = (
  process.env.PUBLIC_APP_URL ??
  process.env.APP_PUBLIC_URL ??
  "https://example.com"
).replace(/\/$/, "");

// Only human-approved, published public answers enter the sitemap. Drafts,
// generated pages, and private /q shares never do.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: `${BASE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE_URL}/guides`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE_URL}/learn`, changeFrequency: "daily", priority: 0.9 },
  ];

  try {
    const guides = await adminDb.collection("ritualGuides").select("slug").get();
    for (const doc of guides.docs) {
      const slug = (doc.data() as { slug?: string }).slug ?? doc.id;
      entries.push({ url: `${BASE_URL}/guides/${slug}`, changeFrequency: "monthly", priority: 0.6 });
    }
  } catch {
    // Sitemap generation must not fail the site if Firestore is unreachable.
  }

  try {
    const answers = await adminDb
      .collection("publicAnswers")
      .where("reviewStatus", "==", "published")
      .get();
    for (const doc of answers.docs) {
      const a = doc.data() as PublicAnswer;
      if (a.indexingStatus !== "index") continue;
      entries.push({
        url: `${BASE_URL}${a.route}`,
        lastModified: a.lastReviewedAt ? new Date(a.lastReviewedAt) : undefined,
        changeFrequency: "monthly",
        priority: 0.7,
      });
    }
  } catch {
    // Same: degrade to the static entries.
  }

  return entries;
}
