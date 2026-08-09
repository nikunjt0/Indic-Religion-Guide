import type { SourceGroup } from "../../lib/types/firestore.ts";

const DEFAULT_SMS_SEGMENT = 1500;

// Strip "### SOURCE N" blocks from the model output for the SMS body. Keep the
// PRACTICE body intact; collapse repeated blank lines. The SOURCE blocks are
// surfaced separately as a compact citation tail.
export function stripSourceBlocks(content: string): string {
  const idx = content.search(/\n###\s+SOURCE\s+\d+/i);
  const head = idx >= 0 ? content.slice(0, idx) : content;
  return head
    .replace(/^###\s+PRACTICE\b[^\n]*\n?/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Pull the source titles out of the "### SOURCE N — Title" headers. We don't
// try to render the per-source body in SMS — too noisy. A title list is enough
// for the user to look up the citation if curious.
export function citationTail(content: string): string {
  const titles: string[] = [];
  const re = /^###\s+SOURCE\s+\d+\s*[—–-]\s*(.+?)\s*$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const t = m[1].trim();
    if (t && !titles.includes(t)) titles.push(t);
  }
  if (titles.length === 0) return "";
  return `\n\nSources: ${titles.join("; ")}`;
}

// Build the citation tail from the structured source list rather than the
// answer text. The SMS guru prompt emits a synthesis without "### SOURCE"
// headers, so citationTail() finds nothing — this is the fallback used when a
// share link can't be created.
export function citationTailFromSources(sources: SourceGroup[]): string {
  const labels = compactSourceLabels(sources);
  if (labels.length === 0) return "";
  return `\n\nSources: ${labels.join("; ")}`;
}

export function citationTailWithUrl(sources: SourceGroup[], url: string): string {
  const labels = compactSourceLabels(sources);
  const compact = labels.length > 0 ? `Sources: ${labels.join("; ")}` : "Sources";
  return `\n\n${compact}\nFull source excerpts: ${url}`;
}

export function compactSourceLabels(sources: SourceGroup[], maxSources = 3): string[] {
  const labels: string[] = [];
  for (const source of sources) {
    const title = compactSourceTitle(source.source_title);
    if (!title) continue;
    const refs = compactRefs(source);
    const label = refs ? `${title} ${refs}` : title;
    if (!labels.includes(label)) labels.push(label);
    if (labels.length >= maxSources) break;
  }
  return labels;
}

function compactSourceTitle(title: string): string {
  return title
    .trim()
    .replace(/^the complete book of\s+/i, "")
    .replace(/\s+/g, " ");
}

function compactRefs(source: SourceGroup): string {
  const verseRefs: string[] = [];
  const pages: number[] = [];
  for (const q of source.quotes) {
    const chapter = q.chapter?.trim();
    const verse = q.verse?.trim();
    if (chapter && verse) {
      const ref = `${chapter}.${verse}`;
      if (!verseRefs.includes(ref)) verseRefs.push(ref);
      continue;
    }
    if (chapter && !verseRefs.includes(chapter)) {
      verseRefs.push(chapter);
      continue;
    }
    if (Number.isFinite(q.page) && !pages.includes(q.page)) pages.push(q.page);
  }
  if (verseRefs.length > 0) return verseRefs.slice(0, 2).join(", ");
  if (pages.length === 1) return `p.${pages[0]}`;
  if (pages.length > 1) return `pp.${pages.slice(0, 3).join(", ")}`;
  return "";
}

// SMS has no markdown renderer — the LLM's `**bold**` etc. would appear as
// literal punctuation. Strip the markdown the prompt produces back to plain
// text. Order matters: handle compound markers (**, __, ~~) before their
// single-char counterparts so we don't half-strip them.
export function toSmsPlainText(content: string): string {
  let out = content;
  // Strong: **text** / __text__
  out = out.replace(/\*\*([^*\n][^*]*?)\*\*/g, "$1");
  out = out.replace(/__([^_\n][^_]*?)__/g, "$1");
  // Strikethrough: ~~text~~
  out = out.replace(/~~([^~\n]+?)~~/g, "$1");
  // Inline code: `text`
  out = out.replace(/`([^`\n]+?)`/g, "$1");
  // Markdown links [text](url) -> text  (URLs in SMS belong in the tail)
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // Per-line cleanup
  out = out
    .split("\n")
    .map((line) => {
      // Leading heading hashes: "### Foo" -> "Foo"
      let l = line.replace(/^\s{0,3}#{1,6}\s+/, "");
      // Bullet markers "- foo" / "* foo" -> "• foo" (asterisks read as broken markdown)
      l = l.replace(/^(\s*)[*-]\s+/, "$1• ");
      return l;
    })
    .join("\n");
  // Emphasis: *text* / _text_  (do last so we don't eat list bullets)
  out = out.replace(/(^|[^*\w])\*([^\s*][^*\n]*?[^\s*])\*(?!\w)/g, "$1$2");
  out = out.replace(/(^|[^_\w])_([^\s_][^_\n]*?[^\s_])_(?!\w)/g, "$1$2");
  // Collapse any 3+ blank lines down to two.
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

// Split a long string into ≤maxLen chunks at paragraph / sentence / whitespace
// boundaries when possible. iMessage handles long single messages fine but
// chunking improves readability in the conversation timeline.
export function splitForSms(text: string, maxLen = DEFAULT_SMS_SEGMENT): string[] {
  const out: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf("\n\n", maxLen);
    if (cut < maxLen * 0.5) cut = remaining.lastIndexOf("\n", maxLen);
    if (cut < maxLen * 0.5) cut = remaining.lastIndexOf(". ", maxLen);
    if (cut < maxLen * 0.5) cut = remaining.lastIndexOf(" ", maxLen);
    if (cut <= 0) cut = maxLen;
    out.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining.length > 0) out.push(remaining);
  return out;
}
