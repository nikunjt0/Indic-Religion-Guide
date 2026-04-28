import { adminDb } from "../lib/firebase/admin";

interface Args { dryRun: boolean }

function parseArgs(): Args {
  return { dryRun: process.argv.includes("--dry-run") };
}

async function main() {
  const { dryRun } = parseArgs();
  const snap = await adminDb.collection("sources").get();
  const empties = snap.docs.filter((d) => ((d.data().chunkCount ?? 0) === 0));

  if (empties.length === 0) {
    console.log("No source docs with chunkCount=0. Nothing to clean up.");
    process.exit(0);
  }

  console.log(`Found ${empties.length} source doc(s) with chunkCount=0:`);
  for (const d of empties) {
    const data = d.data();
    const actual = await adminDb
      .collection("chunks")
      .where("sourceId", "==", d.id)
      .count()
      .get();
    console.log(
      `  ${d.id.slice(0, 12)}  ${(data.title ?? "?").padEnd(30)}  file=${data.filename}  actualChunks=${actual.data().count}`,
    );
    if (actual.data().count !== 0) {
      console.log(`    SKIP: real chunks exist for this sourceId; aborting to be safe.`);
      process.exit(1);
    }
  }

  if (dryRun) {
    console.log("\n(dry run — no deletion)");
    process.exit(0);
  }

  console.log("\nDeleting...");
  for (const d of empties) await d.ref.delete();
  console.log(`Deleted ${empties.length} empty source doc(s).`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
