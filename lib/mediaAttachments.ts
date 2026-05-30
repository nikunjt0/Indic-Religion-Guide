// Client-side media preprocessing for chat attachments.
//
// The text bot's API accepts a list of image data URLs; videos are not sent
// raw (neither OpenAI nor Anthropic chat APIs ingest video files). Instead we
// extract evenly-spaced keyframes here in the browser and ship those as
// images. That keeps the server stateless and avoids an ffmpeg dependency.
//
// Photos are downscaled to a longest-edge cap that matches gpt-4o's high-
// detail tile budget — sending larger images wastes bandwidth and tokens
// without improving the answer.

export interface ChatAttachment {
  kind: "image" | "video-frame";
  dataUrl: string;
  // Display-only metadata, used to render the composer chip.
  sourceName: string;
  frameIndex?: number;
  frameTotal?: number;
}

const MAX_IMAGE_EDGE = 1568;
const JPEG_QUALITY = 0.85;
const VIDEO_FRAME_COUNT = 6;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export async function processFile(file: File): Promise<ChatAttachment[]> {
  if (file.type.startsWith("image/")) {
    return [await processImage(file)];
  }
  if (file.type.startsWith("video/")) {
    if (file.size > MAX_VIDEO_BYTES) {
      throw new Error(
        `Video is ${(file.size / 1024 / 1024).toFixed(0)}MB — keep it under 100MB.`,
      );
    }
    return await extractVideoFrames(file, VIDEO_FRAME_COUNT);
  }
  throw new Error(`Unsupported file type: ${file.type || "unknown"}`);
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

async function extractVideoFrames(
  file: File,
  count: number,
): Promise<ChatAttachment[]> {
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
