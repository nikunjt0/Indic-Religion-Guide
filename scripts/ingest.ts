import { readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "../lib/firebase/admin";
import { chunkPages } from "./lib/chunk";
import { embedAll } from "./lib/embed";
import { loadPdf } from "./lib/pdf";
import { lookupManifest } from "./lib/manifest";

interface Args {
  file?: string;
  all?: boolean;
  dryRun: boolean;
  force: boolean;
  limit?: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Args = { dryRun: false, force: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--file") out.file = args[++i];
    else if (a === "--all") out.all = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--force") out.force = true;
    else if (a === "--limit") out.limit = Number(args[++i]);
  }
  if (!out.file && !out.all) {
    console.error("Usage: tsx scripts/ingest.ts --file <path> | --all [--dry-run] [--force] [--limit N]");
    process.exit(1);
  }
  return out;
}

function resolveFiles(args: Args): string[] {
  if (args.file) return [resolve(args.file)];
  const root = resolve("manuscripts");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.toLowerCase().endsWith(".pdf")) files.push(full);
    }
  };
  walk(root);
  return files;
}

async function ingestFile(path: string, args: Args): Promise<void> {
  const filename = basename(path);
  const meta = lookupManifest(filename);
  if (!meta) {
    console.warn(`skip ${filename} — no manifest entry`);
    return;
  }

  console.log(`\n==> ${filename}`);
  const { fileHash, pageCount, pages } = await loadPdf(path);
  console.log(`    loaded ${pageCount} pages, hash=${fileHash.slice(0, 12)}`);

  const sourceId = fileHash;
  const sourceRef = adminDb.collection("sources").doc(sourceId);
  const existing = await sourceRef.get();
  if (existing.exists && !args.force) {
    const data = existing.data();
    if ((data?.chunkCount ?? 0) > 0) {
      console.log(`    already ingested (chunkCount=${data?.chunkCount}); skip (use --force to re-ingest)`);
      return;
    }
  }

  let chunks = chunkPages(pages);
  if (args.limit) chunks = chunks.slice(0, args.limit);
  console.log(`    chunked into ${chunks.length} pieces`);

  if (args.dryRun) {
    console.log(`    [dry-run] sample chunk:`);
    console.log(`      page ${chunks[0]?.page} verse ${chunks[0]?.verse}`);
    console.log(`      "${chunks[0]?.text.slice(0, 200).replace(/\s+/g, " ")}..."`);
    return;
  }

  console.log(`    embedding...`);
  const vectors = await embedAll(chunks.map((c) => c.text));
  console.log(`    embedded ${vectors.length} chunks`);

  const now = Date.now();
  const writer = adminDb.bulkWriter();

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const v = vectors[i];
    const chunkId = `${sourceId}_${i.toString().padStart(6, "0")}`;
    const ref = adminDb.collection("chunks").doc(chunkId);
    writer.set(ref, {
      id: chunkId,
      sourceId,
      chunkIndex: i,
      text: c.text,
      tokenCount: c.tokenCount,
      page: c.page,
      chapter: c.chapter,
      verse: c.verse,
      tradition: meta.tradition,
      text_type: meta.text_type,
      book: meta.book ?? null,
      translator: meta.translator ?? null,
      language: meta.language,
      tags: meta.tags,
      embedding: FieldValue.vector(v),
      createdAt: now,
    });
  }

  await writer.close();

  await sourceRef.set(
    {
      id: sourceId,
      title: meta.title,
      tradition: meta.tradition,
      text_type: meta.text_type,
      book: meta.book ?? null,
      translator: meta.translator ?? null,
      language: meta.language,
      filename,
      fileHash,
      pageCount,
      chunkCount: chunks.length,
      ingestedAt: now,
    },
    { merge: true },
  );

  console.log(`    wrote ${chunks.length} chunks + source doc`);
}

async function main() {
  const args = parseArgs();
  const files = resolveFiles(args);
  console.log(`Ingesting ${files.length} file(s)`);
  for (const f of files) {
    try {
      await ingestFile(f, args);
    } catch (err) {
      console.error(`ERROR on ${f}:`, err);
    }
  }
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
