import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  downloadAttachment,
  type BlueBubblesAttachment,
} from "./bluebubbles.ts";
import { config } from "./config.ts";
import { log } from "./logger.ts";

export interface BridgeMediaAttachment {
  kind: "image" | "video-frame";
  dataUrl: string;
  sourceName?: string;
  frameIndex?: number;
  frameTotal?: number;
}

const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const MAX_DIRECT_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 12;
const VIDEO_SECONDS_PER_FRAME = 4;
const MIN_VIDEO_FRAMES = 4;
const MAX_VIDEO_FRAMES = 12;
const MAX_IMAGE_EDGE = 1568;

export async function prepareIncomingMedia(
  attachments: BlueBubblesAttachment[],
): Promise<BridgeMediaAttachment[]> {
  const prepared: BridgeMediaAttachment[] = [];

  for (const attachment of attachments) {
    if (prepared.length >= MAX_ATTACHMENTS) break;
    try {
      const file = await downloadAttachment(attachment);
      if (file.bytes.byteLength > MAX_INPUT_BYTES) {
        log.warn(`skipping large attachment ${file.filename}: ${file.bytes.byteLength} bytes`);
        continue;
      }

      if (isImage(file.contentType, file.filename)) {
        prepared.push(await prepareImage(file.bytes, file.contentType, file.filename));
      } else if (isVideo(file.contentType, file.filename)) {
        const frames = await extractVideoFrames(
          file.bytes,
          file.filename,
          MAX_ATTACHMENTS - prepared.length,
        );
        prepared.push(...frames);
      } else {
        log.info(`skipping unsupported text attachment ${file.filename} (${file.contentType})`);
      }
    } catch (err) {
      log.error("failed to prepare text attachment:", err);
    }
  }

  return prepared;
}

export function summarizeMedia(attachments: BridgeMediaAttachment[]): string | undefined {
  if (attachments.length === 0) return undefined;
  const photos = attachments.filter((a) => a.kind === "image").length;
  const frames = attachments.filter((a) => a.kind === "video-frame");
  const parts: string[] = [];
  if (photos > 0) parts.push(`${photos} photo${photos === 1 ? "" : "s"}`);
  if (frames.length > 0) {
    const names = new Set(frames.map((f) => f.sourceName ?? "video"));
    const label = names.size === 1 ? [...names][0] : `${names.size} videos`;
    parts.push(`${frames.length} keyframes from ${label}`);
  }
  return parts.join(", ");
}

export function mediaPreamble(attachments: BridgeMediaAttachment[]): string {
  const summary = summarizeMedia(attachments);
  return `The user sent ${summary ?? "media"} over iMessage. Use the attached photos and chronological video keyframes to identify deities, symbols, ritual implements, gestures, postures, manuscript pages, temple architecture, or other visual context relevant to the question. Then answer in the required ### PRACTICE / ### SOURCE format using the retrieved sources below.`;
}

function isImage(contentType: string, filename: string): boolean {
  return contentType.startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(filename);
}

function isVideo(contentType: string, filename: string): boolean {
  return contentType.startsWith("video/") || /\.(mov|mp4|m4v|webm)$/i.test(filename);
}

async function prepareImage(
  bytes: Buffer,
  contentType: string,
  filename: string,
): Promise<BridgeMediaAttachment> {
  const normalized = normalizedImageType(contentType, filename);
  if (normalized && bytes.byteLength <= MAX_DIRECT_IMAGE_BYTES) {
    return {
      kind: "image",
      dataUrl: dataUrl(bytes, normalized),
      sourceName: filename,
    };
  }

  const converted = await convertImageToJpeg(bytes, filename);
  if (!converted && !normalized) {
    throw new Error(`Unsupported image format: ${filename}`);
  }
  return {
    kind: "image",
    dataUrl: dataUrl(converted ?? bytes, converted ? "image/jpeg" : normalized!),
    sourceName: filename,
  };
}

function normalizedImageType(contentType: string, filename: string): string | undefined {
  if (/^image\/(jpeg|png|webp|gif)$/i.test(contentType)) return contentType.toLowerCase();
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return undefined;
}

function dataUrl(bytes: Buffer, contentType: string): string {
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

async function extractVideoFrames(
  bytes: Buffer,
  filename: string,
  maxFrames: number,
): Promise<BridgeMediaAttachment[]> {
  if (maxFrames <= 0) return [];

  const root = await mkdtemp(path.join(tmpdir(), "indic-guide-video-"));
  try {
    const input = path.join(root, safeFilename(filename));
    await writeFile(input, bytes);
    const duration = await probeDuration(input);
    const desired = Math.min(maxFrames, adaptiveFrameCount(duration));
    const frameDir = path.join(root, "frames");
    await mkdir(frameDir, { recursive: true });

    const timestamps = frameTimestamps(duration, desired);
    const frames: BridgeMediaAttachment[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const output = path.join(frameDir, `frame-${String(i + 1).padStart(3, "0")}.jpg`);
      await runFfmpeg([
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        String(timestamps[i]),
        "-i",
        input,
        "-frames:v",
        "1",
        "-vf",
        `scale=${MAX_IMAGE_EDGE}:${MAX_IMAGE_EDGE}:force_original_aspect_ratio=decrease`,
        "-q:v",
        "3",
        output,
      ]);
      const frame = await readFile(output);
      frames.push({
        kind: "video-frame",
        dataUrl: dataUrl(frame, "image/jpeg"),
        sourceName: filename,
        frameIndex: i + 1,
        frameTotal: timestamps.length,
      });
    }
    return frames;
  } catch (err) {
    log.error(`video frame extraction failed for ${filename}:`, err);
    return [];
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function convertImageToJpeg(
  bytes: Buffer,
  filename: string,
): Promise<Buffer | undefined> {
  const root = await mkdtemp(path.join(tmpdir(), "indic-guide-image-"));
  try {
    const input = path.join(root, safeFilename(filename));
    const output = path.join(root, "image.jpg");
    await writeFile(input, bytes);
    await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      input,
      "-frames:v",
      "1",
      "-vf",
      `scale=${MAX_IMAGE_EDGE}:${MAX_IMAGE_EDGE}:force_original_aspect_ratio=decrease`,
      "-q:v",
      "3",
      output,
    ]);
    return await readFile(output);
  } catch (err) {
    log.warn(`image normalization failed for ${filename}:`, err);
    return undefined;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function adaptiveFrameCount(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return MIN_VIDEO_FRAMES;
  const target = Math.round(durationSeconds / VIDEO_SECONDS_PER_FRAME);
  return Math.min(MAX_VIDEO_FRAMES, Math.max(MIN_VIDEO_FRAMES, target));
}

function frameTimestamps(durationSeconds: number, count: number): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [0];
  if (count <= 1) return [Math.max(0, Math.min(1, durationSeconds * 0.1))];
  const end = Math.max(0.1, durationSeconds - 0.1);
  return Array.from({ length: count }, (_, i) =>
    Number(((end * (i + 0.5)) / count).toFixed(3)),
  );
}

async function probeDuration(input: string): Promise<number> {
  const ffprobe = config.ffprobePath;
  if (!ffprobe) return 0;
  try {
    const { stdout } = await runCommand(ffprobe, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      input,
    ]);
    const duration = Number.parseFloat(stdout.trim());
    return Number.isFinite(duration) ? duration : 0;
  } catch {
    return 0;
  }
}

async function runFfmpeg(args: string[]): Promise<void> {
  await runCommand(config.ffmpegPath, args);
}

async function runCommand(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

function safeFilename(filename: string): string {
  const clean = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return clean || `${randomUUID()}.bin`;
}
