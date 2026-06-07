import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { toFile } from "openai";
import { openai, TRANSCRIBE_MODEL } from "../../lib/openai.ts";
import { downloadAttachment, type BBAttachment } from "./bluebubbles.ts";
import { log } from "./logger.ts";

// Server-side media ingestion for the iMessage bridge. Unlike the web app's
// lib/mediaAttachments.ts (browser-only: Canvas / Web Audio / <video>), this
// runs in Node and leans on the bundled ffmpeg-static binary. Images become
// JPEG data URLs (HEIC normalized along the way), videos become keyframe data
// URLs plus a transcript of the soundtrack, and audio becomes a transcript.

export interface MediaImage {
  kind: "image" | "video-frame";
  dataUrl: string;
}

export interface MediaTranscript {
  sourceName: string;
  text: string;
  truncated?: boolean;
}

export interface ProcessedMedia {
  images: MediaImage[];
  transcripts: MediaTranscript[];
}

// Skip attachments larger than these — they're almost certainly not a quick
// photo/clip a disciple meant to ask about, and they cost tokens/time.
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

// Longest edge we downscale images to — matches the web app's vision tile
// budget (lib/mediaAttachments.ts MAX_IMAGE_EDGE).
const MAX_IMAGE_EDGE = 1568;

// Video keyframe heuristic, mirroring the web app: ~1 frame per 4s, clamped.
const VIDEO_SECONDS_PER_FRAME = 4;
const MIN_VIDEO_FRAMES = 4;
const MAX_VIDEO_FRAMES = 16;

// Transcription cap: gpt-4o-transcribe rejects files >25MB. 16kHz mono PCM is
// ~1.9MB/min, so ~13 minutes. We cap the extracted audio's duration instead of
// its bytes so the WAV header stays valid.
const MAX_TRANSCRIBE_SECONDS = 13 * 60;

// Prime the transcription model toward devotional vocabulary (copied from
// app/api/transcribe/route.ts).
const TRANSCRIBE_PRIME =
  "Hindu devotional audio: mantras, Sanskrit terms, deity names, and questions about puja and ritual practice.";

type MediaKind = "image" | "video" | "audio" | "other";

export async function processAttachments(
  attachments: BBAttachment[],
): Promise<ProcessedMedia> {
  const images: MediaImage[] = [];
  const transcripts: MediaTranscript[] = [];

  for (const att of attachments) {
    try {
      const kind = classify(att);
      if (kind === "other") {
        log.info(`skipping unsupported attachment ${att.transferName ?? att.guid} (${att.mimeType ?? "?"})`);
        continue;
      }
      const max =
        kind === "image" ? MAX_IMAGE_BYTES : kind === "video" ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES;
      if (att.totalBytes && att.totalBytes > max) {
        log.info(`skipping oversized ${kind} ${att.transferName ?? att.guid} (${att.totalBytes} bytes)`);
        continue;
      }

      const bytes = await downloadAttachment(att.guid);
      const name = att.transferName ?? att.guid;

      if (kind === "image") {
        const img = await processImage(bytes, name, att.mimeType);
        if (img) images.push(img);
      } else if (kind === "video") {
        const { frames, transcript } = await processVideo(bytes, name);
        images.push(...frames);
        if (transcript) transcripts.push(transcript);
      } else if (kind === "audio") {
        const transcript = await processAudio(bytes, name);
        if (transcript) transcripts.push(transcript);
      }
    } catch (err) {
      log.error(`failed to process attachment ${att.transferName ?? att.guid}:`, err);
    }
  }

  return { images, transcripts };
}

function classify(att: BBAttachment): MediaKind {
  const m = (att.mimeType ?? "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  // BlueBubbles occasionally omits/garbles mimeType; fall back to extension.
  const ext = (att.transferName ?? "").toLowerCase().split(".").pop() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "tiff", "bmp"].includes(ext)) return "image";
  if (["mov", "mp4", "m4v", "3gp", "avi", "mkv", "webm"].includes(ext)) return "video";
  if (["caf", "amr", "m4a", "mp3", "wav", "aac", "aiff", "ogg", "opus"].includes(ext)) return "audio";
  return "other";
}

// Normalize any image to a downscaled JPEG data URL. Routing through ffmpeg
// both shrinks it to the vision tile budget and converts HEIC (the default
// iPhone photo format, which OpenAI's vision API won't accept) to JPEG. If the
// ffmpeg conversion fails we fall back to the raw bytes when they're already a
// web-safe format, otherwise we skip.
async function processImage(
  bytes: Buffer,
  name: string,
  mimeType: string | null,
): Promise<MediaImage | null> {
  const dir = await mkdtemp(join(tmpdir(), "guru-img-"));
  try {
    const inPath = join(dir, "in");
    const outPath = join(dir, "out.jpg");
    await writeFile(inPath, bytes);
    const { code } = await runFfmpeg([
      "-y",
      "-i",
      inPath,
      "-vf",
      `scale='min(${MAX_IMAGE_EDGE},iw)':-2`,
      "-frames:v",
      "1",
      outPath,
    ]);
    if (code === 0) {
      const jpg = await readFile(outPath);
      return { kind: "image", dataUrl: `data:image/jpeg;base64,${jpg.toString("base64")}` };
    }
    // ffmpeg-static has no HEIC support, and iPhone photos are HEIC by default.
    // Fall back to macOS's native `sips` converter (this bridge is Mac-hosted),
    // which decodes HEIC and downscales in one shot.
    const sipsOk = await runSips([
      "-s",
      "format",
      "jpeg",
      "-Z",
      String(MAX_IMAGE_EDGE),
      inPath,
      "--out",
      outPath,
    ]);
    if (sipsOk) {
      const jpg = await readFile(outPath).catch(() => null);
      if (jpg) return { kind: "image", dataUrl: `data:image/jpeg;base64,${jpg.toString("base64")}` };
    }
    // Last resort: pass the original through only if OpenAI's vision API can
    // read it as-is.
    const m = (mimeType ?? "").toLowerCase();
    if (/^image\/(jpeg|png|gif|webp)$/.test(m)) {
      log.info(`ffmpeg/sips failed on ${name}; sending raw ${m}`);
      return { kind: "image", dataUrl: `data:${m};base64,${bytes.toString("base64")}` };
    }
    log.error(`could not convert image ${name} (${m || "unknown type"}); skipping`);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function processVideo(
  bytes: Buffer,
  name: string,
): Promise<{ frames: MediaImage[]; transcript: MediaTranscript | null }> {
  const dir = await mkdtemp(join(tmpdir(), "guru-vid-"));
  try {
    const inPath = join(dir, "in");
    await writeFile(inPath, bytes);

    const duration = await probeDurationSeconds(inPath);

    // --- keyframes ---
    const frames: MediaImage[] = [];
    let count = MAX_VIDEO_FRAMES;
    let fps = "1/4";
    if (duration && duration > 0) {
      count = Math.max(
        MIN_VIDEO_FRAMES,
        Math.min(MAX_VIDEO_FRAMES, Math.round(duration / VIDEO_SECONDS_PER_FRAME)),
      );
      fps = `${count}/${duration}`;
    }
    const framesOk = await runFfmpeg([
      "-y",
      "-i",
      inPath,
      "-vf",
      `fps=${fps},scale='min(${MAX_IMAGE_EDGE},iw)':-2`,
      "-frames:v",
      String(count),
      "-q:v",
      "3",
      join(dir, "frame_%03d.jpg"),
    ]);
    if (framesOk.code === 0) {
      const files = (await readdir(dir)).filter((f) => f.startsWith("frame_")).sort();
      for (const f of files) {
        const jpg = await readFile(join(dir, f));
        frames.push({ kind: "video-frame", dataUrl: `data:image/jpeg;base64,${jpg.toString("base64")}` });
      }
    } else {
      log.error(`frame extraction failed for ${name}`);
    }

    // --- soundtrack transcript ---
    let transcript: MediaTranscript | null = null;
    try {
      const wavPath = join(dir, "audio.wav");
      const truncated = Boolean(duration && duration > MAX_TRANSCRIBE_SECONDS);
      const audioOk = await runFfmpeg([
        "-y",
        "-i",
        inPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-t",
        String(MAX_TRANSCRIBE_SECONDS),
        wavPath,
      ]);
      if (audioOk.code === 0) {
        const wav = await readFile(wavPath).catch(() => null);
        if (wav && wav.length > 1024) {
          const text = await transcribe(wav, name);
          if (text) transcript = { sourceName: name, text, truncated };
        }
      }
    } catch (err) {
      log.error(`audio transcription failed for video ${name}:`, err);
    }

    return { frames, transcript };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function processAudio(bytes: Buffer, name: string): Promise<MediaTranscript | null> {
  const dir = await mkdtemp(join(tmpdir(), "guru-aud-"));
  try {
    const inPath = join(dir, "in");
    const wavPath = join(dir, "audio.wav");
    await writeFile(inPath, bytes);
    const duration = await probeDurationSeconds(inPath);
    const truncated = Boolean(duration && duration > MAX_TRANSCRIBE_SECONDS);
    // Transcode to 16kHz mono WAV so voice-memo formats (.caf, .amr) work and
    // the file stays under the transcription size cap.
    const { code } = await runFfmpeg([
      "-y",
      "-i",
      inPath,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-t",
      String(MAX_TRANSCRIBE_SECONDS),
      wavPath,
    ]);
    if (code !== 0) {
      log.error(`audio transcode failed for ${name}`);
      return null;
    }
    const wav = await readFile(wavPath).catch(() => null);
    if (!wav || wav.length <= 1024) return null;
    const text = await transcribe(wav, name);
    return text ? { sourceName: name, text, truncated } : null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function transcribe(wav: Buffer, sourceName: string): Promise<string> {
  const file = await toFile(wav, `${sourceName}.wav`, { type: "audio/wav" });
  const result = await openai.audio.transcriptions.create({
    file,
    model: TRANSCRIBE_MODEL,
    prompt: TRANSCRIBE_PRIME,
  });
  return (result.text ?? "").trim();
}

// Read a media file's duration in seconds by parsing ffmpeg's stderr. We run
// ffmpeg with no output file, which makes it print the input's metadata and
// exit non-zero — that exit code is expected here, not an error.
async function probeDurationSeconds(path: string): Promise<number | null> {
  const { stderr } = await runFfmpeg(["-i", path]);
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

// Run macOS `sips`; resolves true on a clean exit. Used only as the HEIC
// fallback for images, so a non-macOS host (no sips) just resolves false.
function runSips(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("sips", args);
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
}

function runFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error("ffmpeg-static binary not found"));
      return;
    }
    const proc = spawn(ffmpegPath, args);
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ code: code ?? -1, stderr }));
  });
}
