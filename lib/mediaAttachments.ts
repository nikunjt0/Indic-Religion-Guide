// Client-side media preprocessing for chat attachments.
//
// The text bot's API accepts a list of image data URLs; videos are not sent
// raw (neither OpenAI nor Anthropic chat APIs ingest video files). Instead we
// extract evenly-spaced keyframes here in the browser and ship those as
// images. That keeps the server stateless and avoids an ffmpeg dependency.
//
// Sound is not lost: for audio files and any video with a decodable audio
// track we lift the audio out here — downmixed to 16kHz mono WAV — so the
// caller can ship it to the transcription endpoint. That lets a chanted mantra
// or a spoken question in a video reach the model as text alongside its frames.
//
// Photos are downscaled to a longest-edge cap that matches the vision model's
// high-detail tile budget — sending larger images wastes bandwidth and tokens
// without improving the answer.

export interface ChatAttachment {
  kind: "image" | "video-frame";
  dataUrl: string;
  // Display-only metadata, used to render the composer chip.
  sourceName: string;
  frameIndex?: number;
  frameTotal?: number;
}

// Audio lifted from an audio/video file, ready to POST to /api/transcribe.
export interface ExtractedAudio {
  blob: Blob;
  sourceName: string;
  // True when the source was longer than we transcribe and the tail was
  // dropped — surfaced to the user so a partial transcript isn't mistaken
  // for the whole recording.
  truncated: boolean;
}

// Result of preparing one picked file. A video yields both keyframes and
// (when decodable) audio; an audio file yields only audio; an image yields
// only an image attachment.
export interface ProcessedFile {
  kind: "image" | "video" | "audio";
  sourceName: string;
  attachments: ChatAttachment[];
  audio?: ExtractedAudio;
}

const MAX_IMAGE_EDGE = 1568;
const JPEG_QUALITY = 0.85;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

// Adaptive keyframe budget: ~1 frame per this many seconds, clamped. Short
// clips no longer waste tokens on 6 near-identical frames; long clips get
// enough coverage to follow a ritual's progression.
const VIDEO_SECONDS_PER_FRAME = 4;
const MIN_VIDEO_FRAMES = 4;
const MAX_VIDEO_FRAMES = 16;

// Transcription target: 16kHz mono is exactly what the speech model wants, and
// keeps the WAV small. At 16-bit that is 32000 bytes/sec, so the cap below
// bounds a transcript to ~13 minutes of audio before we trim the tail.
const TRANSCRIBE_SAMPLE_RATE = 16000;
const MAX_WAV_BYTES = 24 * 1024 * 1024;

export async function processFile(file: File): Promise<ProcessedFile> {
  const sourceName = file.name || "attachment";

  if (file.type.startsWith("image/")) {
    return {
      kind: "image",
      sourceName,
      attachments: [await processImage(file)],
    };
  }

  if (file.type.startsWith("video/")) {
    if (file.size > MAX_VIDEO_BYTES) {
      throw new Error(
        `Video is ${(file.size / 1024 / 1024).toFixed(0)}MB — keep it under 100MB.`,
      );
    }
    const attachments = await extractVideoFrames(file);
    // Best-effort: a video may have no audio track, or the browser may not be
    // able to decode its codec. Either way the frames still carry the turn.
    const audio = await tryExtractAudio(file, sourceName);
    return { kind: "video", sourceName, attachments, audio };
  }

  if (file.type.startsWith("audio/")) {
    if (file.size > MAX_AUDIO_BYTES) {
      throw new Error(
        `Audio is ${(file.size / 1024 / 1024).toFixed(0)}MB — keep it under 100MB.`,
      );
    }
    const audio = await tryExtractAudio(file, sourceName);
    if (!audio) {
      throw new Error(`Could not read audio from ${sourceName}.`);
    }
    return { kind: "audio", sourceName, attachments: [], audio };
  }

  throw new Error(`Unsupported file type: ${file.type || "unknown"}`);
}

function adaptiveFrameCount(durationSeconds: number): number {
  const target = Math.round(durationSeconds / VIDEO_SECONDS_PER_FRAME);
  return Math.min(MAX_VIDEO_FRAMES, Math.max(MIN_VIDEO_FRAMES, target));
}

// One transcript, ready to attach to a turn. `text` is empty when the audio
// was silence or the model returned nothing usable.
export interface Transcript {
  sourceName: string;
  text: string;
  truncated: boolean;
}

// POST extracted audio to the server transcription endpoint. Returns null when
// the audio yields no usable text — callers just drop it.
export async function transcribeAudio(
  audio: ExtractedAudio,
): Promise<Transcript | null> {
  const form = new FormData();
  form.append("audio", audio.blob, `${audio.sourceName}.wav`);
  form.append("sourceName", audio.sourceName);

  const res = await fetch("/api/transcribe", { method: "POST", body: form });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Transcription failed (${res.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  const data = (await res.json()) as { text?: string };
  const text = (data.text ?? "").trim();
  if (!text) return null;
  return { sourceName: audio.sourceName, text, truncated: audio.truncated };
}

async function processImage(file: File): Promise<ChatAttachment> {
  const bitmap = await loadImageBitmap(file);
  const { canvas, ctx } = downscaleToCanvas(
    bitmap.width,
    bitmap.height,
    MAX_IMAGE_EDGE,
  );
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  return { kind: "image", dataUrl, sourceName: file.name };
}

async function extractVideoFrames(file: File): Promise<ChatAttachment[]> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    // Mobile Safari needs the element in the DOM for some codecs to decode.
    video.style.position = "fixed";
    video.style.top = "-9999px";
    video.style.left = "-9999px";
    document.body.appendChild(video);

    try {
      await waitForEvent(video, "loadedmetadata");
      const duration = isFinite(video.duration) ? video.duration : 0;
      if (duration <= 0) {
        throw new Error("Could not read video duration.");
      }

      // Frame budget scales with length: a 5s clip gets the floor, a 60s clip
      // gets ~15 frames, anything longer is capped.
      const count = adaptiveFrameCount(duration);

      const { canvas, ctx } = downscaleToCanvas(
        video.videoWidth,
        video.videoHeight,
        MAX_IMAGE_EDGE,
      );

      const frames: ChatAttachment[] = [];
      for (let i = 0; i < count; i++) {
        // Sample at the midpoint of each evenly-spaced segment so the first
        // and last frames aren't pinned to black title/credit frames.
        const t = ((i + 0.5) / count) * duration;
        await seekTo(video, Math.min(t, Math.max(0, duration - 0.05)));
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        frames.push({
          kind: "video-frame",
          dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY),
          sourceName: file.name,
          frameIndex: i + 1,
          frameTotal: count,
        });
      }
      return frames;
    } finally {
      video.remove();
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Decode the file's audio track, downmix to 16kHz mono, and encode a WAV.
// Returns undefined when there is no audio or the browser can't decode the
// container — callers treat audio as optional enrichment, never required.
async function tryExtractAudio(
  file: File,
  sourceName: string,
): Promise<ExtractedAudio | undefined> {
  const AudioCtx: typeof AudioContext | undefined =
    typeof window !== "undefined"
      ? window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      : undefined;
  if (!AudioCtx || typeof OfflineAudioContext === "undefined") return undefined;

  let decoded: AudioBuffer;
  const decodeCtx = new AudioCtx();
  try {
    const buf = await file.arrayBuffer();
    // decodeAudioData copies the buffer; some browsers reject a transferred
    // one, so pass a fresh slice.
    decoded = await decodeCtx.decodeAudioData(buf.slice(0));
  } catch {
    return undefined;
  } finally {
    decodeCtx.close().catch(() => {});
  }

  if (decoded.length === 0 || decoded.duration <= 0) return undefined;

  // Resample + downmix to mono via an offline graph at the target rate.
  const frameCount = Math.ceil(decoded.duration * TRANSCRIBE_SAMPLE_RATE);
  const offline = new OfflineAudioContext(1, frameCount, TRANSCRIBE_SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  let mono = rendered.getChannelData(0);

  // Bound the WAV size: 44-byte header + 2 bytes/sample. Trim the tail if the
  // recording is longer than we transcribe.
  const maxSamples = Math.floor((MAX_WAV_BYTES - 44) / 2);
  const truncated = mono.length > maxSamples;
  if (truncated) mono = mono.subarray(0, maxSamples);

  const blob = encodeWav(mono, TRANSCRIBE_SAMPLE_RATE);
  return { blob, sourceName, truncated };
}

// Minimal 16-bit PCM WAV encoder (RIFF/PCM, mono).
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function loadImageBitmap(file: File): Promise<ImageBitmap> {
  // createImageBitmap handles EXIF orientation in modern browsers and decodes
  // off the main thread. Falls back to <img> for older browsers.
  if (typeof createImageBitmap === "function") {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await waitForEvent(img, "load");
    const bmp = await createImageBitmap(img);
    return bmp;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function downscaleToCanvas(
  srcW: number,
  srcH: number,
  maxEdge: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  return { canvas, ctx };
}

function waitForEvent(
  el: HTMLElement,
  event: string,
  timeoutMs = 15_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onEvt = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error(`Failed to load media (${event})`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    function cleanup() {
      el.removeEventListener(event, onEvt);
      el.removeEventListener("error", onErr);
      clearTimeout(timer);
    }
    el.addEventListener(event, onEvt, { once: true });
    el.addEventListener("error", onErr, { once: true });
  });
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error("Video seek failed"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Video seek timed out"));
    }, 15_000);
    function cleanup() {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onErr);
      clearTimeout(timer);
    }
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onErr, { once: true });
    video.currentTime = t;
  });
}
