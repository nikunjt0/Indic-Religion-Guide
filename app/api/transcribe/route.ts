import { toFile } from "openai";
import { openai, TRANSCRIBE_MODEL } from "@/lib/openai";

// Speech-to-text for audio attachments and the audio track lifted out of a
// video. The client extracts a 16kHz mono WAV (see lib/mediaAttachments.ts)
// and posts it here as multipart form data; we hand it to the transcription
// model and return the plain text. Kept separate from /api/ask so the heavy
// audio upload doesn't ride along with every streamed answer.

// OpenAI's transcription endpoint rejects files over 25MB. The client trims to
// ~24MB before upload; this is the server-side backstop.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "expected multipart form data" }, { status: 400 });
  }

  const audio = form.get("audio");
  if (!(audio instanceof Blob)) {
    return Response.json({ error: "missing audio file" }, { status: 400 });
  }
  if (audio.size === 0) {
    return Response.json({ error: "empty audio file" }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return Response.json(
      { error: `audio exceeds ${MAX_AUDIO_BYTES / 1024 / 1024}MB limit` },
      { status: 413 },
    );
  }

  const sourceName =
    typeof form.get("sourceName") === "string"
      ? (form.get("sourceName") as string)
      : "audio";

  try {
    const file = await toFile(audio, `${sourceName}.wav`, { type: "audio/wav" });
    const result = await openai.audio.transcriptions.create({
      file,
      model: TRANSCRIBE_MODEL,
      // The recordings are devotional: chanted mantras, spoken Sanskrit terms,
      // and questions about ritual. Prime the model so it favors that vocabulary.
      prompt:
        "Hindu devotional audio: mantras, Sanskrit terms, deity names, and questions about puja and ritual practice.",
    });

    return Response.json({ text: result.text ?? "" });
  } catch (err) {
    return Response.json(
      { error: (err as Error).message || "transcription failed" },
      { status: 502 },
    );
  }
}
