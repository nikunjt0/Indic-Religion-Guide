import { adminDb } from "../lib/firebase/admin";

// Backfill: stamp freeTestingUser=true on every imessageUsers doc that isn't
// already true, so existing users get the same free access new signups now
// start with (paid billing state is left untouched). Run with:
//   npx tsx --env-file=.env scripts/backfill-free-testing-flag.ts

async function main(): Promise<void> {
  const snap = await adminDb.collection("imessageUsers").get();
  let updated = 0;
  let skipped = 0;
  for (const doc of snap.docs) {
    if (doc.data().freeTestingUser === true) {
      skipped++;
      continue;
    }
    await doc.ref.set({ freeTestingUser: true, updatedAt: Date.now() }, { merge: true });
    updated++;
  }
  console.log(
    `freeTestingUser backfill: ${updated} stamped true, ${skipped} already true, ${snap.size} total users`
  );
}

main().catch((err) => {
  console.error("backfill failed:", err);
  process.exit(1);
});
