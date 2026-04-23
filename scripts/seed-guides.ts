import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { adminDb } from "../lib/firebase/admin";
import type { RitualGuide } from "../lib/types/firestore";

async function main() {
  const dir = join(process.cwd(), "data", "ritual-guides");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

  console.log(`Seeding ${files.length} ritual guides...`);

  const now = Date.now();
  const writer = adminDb.bulkWriter();

  for (const file of files) {
    const raw = readFileSync(join(dir, file), "utf-8");
    const guide = JSON.parse(raw) as RitualGuide;
    guide.updatedAt = now;

    const ref = adminDb.collection("ritualGuides").doc(guide.slug);
    writer.set(ref, guide, { merge: true });
    console.log(`  + ${guide.slug}`);
  }

  await writer.close();
  console.log(`Done. Seeded ${files.length} guides.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
