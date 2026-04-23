import { get_encoding } from "tiktoken";

const encoding = get_encoding("cl100k_base");

export interface RawChunk {
  text: string;
  tokenCount: number;
  page: number;
  chapter: string | null;
  verse: string | null;
}

// Matches verse markers like 2.47 or 1.87.3 or "1.1 " at start of segment.
const VERSE_MARKER = /\b(\d{1,3})\.(\d{1,3})(?:\.(\d{1,3}))?\b/;

interface ChunkOpts {
  targetTokens?: number;
  overlapTokens?: number;
}

export function chunkPages(
  pages: string[],
  opts: ChunkOpts = {},
): RawChunk[] {
  const target = opts.targetTokens ?? 600;
  const overlap = opts.overlapTokens ?? 60;

  const chunks: RawChunk[] = [];

  // Walk page-by-page so each chunk carries an authoritative page number.
  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageNum = pageIdx + 1;
    const raw = pages[pageIdx]?.replace(/\s+\n/g, "\n").trim();
    if (!raw) continue;

    // Split page into paragraph-ish segments, then pack into token-sized chunks.
    const paragraphs = raw.split(/\n{2,}/).filter((p) => p.trim().length > 0);

    let buffer = "";
    let bufferTokens = 0;
    let currentVerse: string | null = null;

    const flush = () => {
      if (!buffer.trim()) return;
      const m = buffer.match(VERSE_MARKER);
      const verse = currentVerse ?? (m ? `${m[1]}.${m[2]}${m[3] ? `.${m[3]}` : ""}` : null);
      const chapter = verse ? verse.split(".")[0] : null;
      chunks.push({
        text: buffer.trim(),
        tokenCount: bufferTokens,
        page: pageNum,
        chapter,
        verse,
      });
      // Seed next buffer with the tail for overlap.
      if (overlap > 0 && bufferTokens > overlap) {
        const tailTokens = encoding.encode(buffer).slice(-overlap);
        const tailText = new TextDecoder().decode(encoding.decode(tailTokens));
        buffer = tailText;
        bufferTokens = tailTokens.length;
      } else {
        buffer = "";
        bufferTokens = 0;
      }
    };

    for (const para of paragraphs) {
      const paraTokens = encoding.encode(para).length;

      // Update the running verse marker from the paragraph if present.
      const m = para.match(VERSE_MARKER);
      if (m) currentVerse = `${m[1]}.${m[2]}${m[3] ? `.${m[3]}` : ""}`;

      // If this paragraph alone exceeds the target, emit the current buffer, then
      // emit the paragraph as its own chunk (oversize tolerated over splitting mid-verse).
      if (paraTokens > target) {
        flush();
        chunks.push({
          text: para.trim(),
          tokenCount: paraTokens,
          page: pageNum,
          chapter: currentVerse ? currentVerse.split(".")[0] : null,
          verse: currentVerse,
        });
        buffer = "";
        bufferTokens = 0;
        continue;
      }

      if (bufferTokens + paraTokens > target) {
        flush();
      }
      buffer = buffer ? `${buffer}\n\n${para}` : para;
      bufferTokens += paraTokens;
    }

    flush();
  }

  return chunks;
}
