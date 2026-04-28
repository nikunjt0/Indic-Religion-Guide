import { adminDb } from "../lib/firebase/admin";
import { manifest } from "./lib/manifest";

async function main() {
  const sourcesSnap = await adminDb.collection("sources").get();
  const sources = sourcesSnap.docs.map((d) => d.data() as {
    id: string;
    title: string;
    filename: string;
    pageCount: number;
    chunkCount: number;
  });

  const ingestedFilenames = new Set(sources.map((s) => s.filename));
  const manifestFilenames = Object.keys(manifest);

  console.log(`\nSources in Firestore: ${sources.length}`);
  console.log(`Manifest entries: ${manifestFilenames.length}`);

  console.log(`\nIngested:`);
  for (const s of sources.slice().sort((a, b) => a.title.localeCompare(b.title))) {
    console.log(`  ${s.title.padEnd(45)} pages=${String(s.pageCount).padEnd(4)} chunks=${s.chunkCount}  file=${s.filename}`);
  }

  const missing = manifestFilenames.filter((f) => !ingestedFilenames.has(f));
  if (missing.length) {
    console.log(`\nNot ingested (${missing.length}):`);
    for (const f of missing) console.log(`  ${f}`);
  } else {
    console.log(`\nAll manifest files are ingested.`);
  }

  const zeroChunks = sources.filter((s) => (s.chunkCount ?? 0) === 0);
  if (zeroChunks.length) {
    console.log(`\nSources with zero chunks (${zeroChunks.length}):`);
    for (const s of zeroChunks) console.log(`  ${s.filename}`);
  } else {
    console.log(`\nAll source docs have chunks.`);
  }

  const totalChunks = await adminDb.collection("chunks").count().get();
  console.log(`\nTotal chunks: ${totalChunks.data().count}`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
