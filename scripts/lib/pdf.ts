import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { extractText } from "unpdf";

export interface LoadedPdf {
  fileHash: string;
  pageCount: number;
  pages: string[];
}

export async function loadPdf(filePath: string): Promise<LoadedPdf> {
  const buffer = readFileSync(filePath);
  const fileHash = createHash("sha256").update(buffer).digest("hex");
  const { totalPages, text } = await extractText(new Uint8Array(buffer), {
    mergePages: false,
  });
  return { fileHash, pageCount: totalPages, pages: text };
}
