import { adminDb } from "../lib/firebase/admin";
import { loadAllProgramFiles } from "../lib/programs/content";

// Seed program metadata + lessons from content/programs/*.json into Firestore.
// The bridge delivers lessons straight from the content files (deterministic,
// versioned with the repo); Firestore copies exist for the web catalog and the
// future admin review UI. Idempotent: re-running overwrites with merge.

async function main(): Promise<void> {
  const programs = loadAllProgramFiles();
  for (const program of programs) {
    const { lessons, ...meta } = program;
    const ref = adminDb.collection("programs").doc(program.slug);
    await ref.set(
      { ...meta, updatedAt: Date.now(), createdAt: meta.createdAt ?? Date.now() },
      { merge: true }
    );
    for (const lesson of lessons) {
      await ref
        .collection("lessons")
        .doc(String(lesson.dayNumber).padStart(2, "0"))
        .set({ ...lesson, updatedAt: Date.now() }, { merge: true });
    }
    console.log(`seeded ${program.slug}: ${lessons.length} lessons (status=${program.status})`);
  }
  console.log(`done — ${programs.length} programs`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
