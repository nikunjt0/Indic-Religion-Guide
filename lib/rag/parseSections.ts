export interface ParsedSections {
  bySourceIndex: Record<number, string>;
  practice: string | null;
}

// Split LLM output into its ### PRACTICE and ### SOURCE <N> sections.
// Designed to handle mid-stream input too: the last section may still be
// growing, so callers re-run as tokens arrive.
export function parseSections(text: string): ParsedSections {
  const re = /###\s+(SOURCE\s+(\d+)|PRACTICE)\b[^\n]*\n?/gi;
  const marks: {
    start: number;
    end: number;
    kind: "source" | "practice";
    sourceIdx?: number;
  }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const isSource = /^SOURCE/i.test(m[1]);
    marks.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: isSource ? "source" : "practice",
      sourceIdx: isSource ? Number(m[2]) : undefined,
    });
  }
  const bySourceIndex: Record<number, string> = {};
  let practice: string | null = null;
  for (let i = 0; i < marks.length; i++) {
    const cur = marks[i];
    const nextStart = marks[i + 1]?.start ?? text.length;
    const body = text.slice(cur.end, nextStart).trim();
    if (cur.kind === "source" && cur.sourceIdx != null) {
      bySourceIndex[cur.sourceIdx] = body;
    } else if (cur.kind === "practice") {
      practice = body;
    }
  }
  return { bySourceIndex, practice };
}
