import { adminDb } from "../lib/firebase/admin";

// One-off backfill: stamp freeTestingUser=false on every imessageUsers doc
// that doesn't have the flag yet, so it's visible (and flippable) in the
// Firestore console for existing users. Run with:
//   npx tsx --env-file=.env scripts/backfill-free-testing-flag.ts

async function main(): Promise<void> {
  const snap = await adminDb.collection("imessageUsers").get();
  let updated = 0;
  let skipped = 0;
  for (const doc of snap.docs) {
    if (typeof doc.data().freeTestingUser === "boolean") {
      skipped++;
      continue;
    }
    await doc.ref.set({ freeTestingUser: false, updatedAt: Date.now() }, { merge: true });
    updated++;
  }
  console.log(
    `freeTestingUser backfill: ${updated} stamped false, ${skipped} already flagged, ${snap.size} total users`
  );
}

main().catch((err) => {
  console.error("backfill failed:", err);
  process.exit(1);
});
