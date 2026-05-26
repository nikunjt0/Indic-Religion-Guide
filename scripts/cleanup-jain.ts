import { adminDb } from "../lib/firebase/admin";

interface Args {
  dryRun: boolean;
}

function parseArgs(): Args {
  return { dryRun: process.argv.includes("--dry-run") };
}

const COLLECTIONS = ["chunks", "sources", "ritualGuides"] as const;
const BATCH_SIZE = 400;

async function deleteWhereJain(
  collection: (typeof COLLECTIONS)[number],
  dryRun: boolean,
): Promise<{ found: number; deleted: number }> {
  let total = 0;
  let deleted = 0;
  while (true) {
    const snap = await adminDb
      .collection(collection)
      .where("tradition", "==", "jain")
      .limit(BATCH_SIZE)
      .get();
    if (snap.empty) break;
    total += snap.size;
    if (dryRun) {
      for (const d of snap.docs.slice(0, 5)) {
        const data = d.data();
        console.log(`  [${collection}] ${d.id.slice(0, 16)}  ${data.title ?? data.slug ?? "?"}`);
      }
      if (snap.size > 5) console.log(`  …and ${snap.size - 5} more`);
      break;
    }
    const writer = adminDb.batch();
    for (const d of snap.docs) writer.delete(d.ref);
    await writer.commit();
    deleted += snap.size;
    if (snap.size < BATCH_SIZE) break;
  }
  return { found: total, deleted };
}

async function main() {
  const { dryRun } = parseArgs();
  console.log(dryRun ? "Dry run — no deletes.\n" : "Deleting jain-tagged docs.\n");
  for (const c of COLLECTIONS) {
    const { found, deleted } = await deleteWhereJain(c, dryRun);
    console.log(`${c}: found=${found} deleted=${deleted}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
