function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  bbUrl: (process.env.BB_URL ?? "http://localhost:1234").replace(/\/$/, ""),
  bbPassword: required("BB_PASSWORD"),
  // Origin used to build sharable /q/<id> URLs sent in SMS replies. No
  // default — if APP_PUBLIC_URL is unset the bridge skips the share link
  // and falls back to the plain citation tail.
  appPublicUrl: (process.env.APP_PUBLIC_URL ?? "").replace(/\/$/, ""),
  maxHistoryMessages: 8,
  maxSmsSegment: 1500,
  triggerWord: "guru",
  ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg",
  ffprobePath: process.env.FFPROBE_PATH ?? "ffprobe",
};
