import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ProgramWithLessons } from "./engine";

// Loader for the versioned program JSON files in content/programs/. These are
// the reviewed, deterministic lesson texts — the LLM never rewrites them.
// Resolves from the repo root whether the process runs from the root (Next)
// or from bridge/ (the bridge daemon).

function contentDir(): string {
  const candidates = [
    path.join(process.cwd(), "content", "programs"),
    path.join(process.cwd(), "..", "content", "programs"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return candidates[0];
}

const CONTENT_DIR = contentDir();

export function loadProgramFile(slug: string): ProgramWithLessons {
  const file = path.join(CONTENT_DIR, `${slug}.json`);
  const parsed = JSON.parse(readFileSync(file, "utf8")) as ProgramWithLessons;
  validateProgram(parsed);
  return parsed;
}

export function loadAllProgramFiles(): ProgramWithLessons[] {
  return readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const parsed = JSON.parse(
        readFileSync(path.join(CONTENT_DIR, f), "utf8")
      ) as ProgramWithLessons;
      validateProgram(parsed);
      return parsed;
    });
}

export function validateProgram(p: ProgramWithLessons): void {
  const problems: string[] = [];
  if (!p.slug) problems.push("missing slug");
  if (!p.title) problems.push("missing title");
  if (!Array.isArray(p.lessons) || p.lessons.length === 0) problems.push("no lessons");
  if (p.lessons && p.durationDays !== p.lessons.length) {
    problems.push(`durationDays (${p.durationDays}) != lessons.length (${p.lessons?.length})`);
  }
  const days = new Set<number>();
  for (const l of p.lessons ?? []) {
    if (!l.standardMessage?.trim()) problems.push(`day ${l.dayNumber}: empty standardMessage`);
    if (days.has(l.dayNumber)) problems.push(`duplicate dayNumber ${l.dayNumber}`);
    days.add(l.dayNumber);
  }
  for (let d = 1; d <= (p.durationDays ?? 0); d++) {
    if (!days.has(d)) problems.push(`missing dayNumber ${d}`);
  }
  if (problems.length > 0) {
    throw new Error(`invalid program ${p.slug ?? "?"}: ${problems.join("; ")}`);
  }
}
