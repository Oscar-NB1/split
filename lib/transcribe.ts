/**
 * Turning a recording into words.
 *
 * Anthropic's API takes text, images and PDFs — not audio — so this is the one place in the app
 * that talks to a different provider, and it is deliberately the only place. Any service with
 * an OpenAI-compatible `/audio/transcriptions` endpoint works: OpenAI's own Whisper, Groq,
 * Deepgram's compatibility layer, or something self-hosted. The endpoint and model are
 * configuration rather than a decision baked into the code.
 *
 * Missing configuration is a working state, not a broken one. Without a key the recorder is
 * hidden and the athlete types — which is what the week-rebuild box has always asked for
 * ("say it out loud if that is easier — use your keyboard's microphone") and which needs no
 * provider at all. The point of the feature is the words; the microphone is a convenience.
 */

const DEFAULT_URL = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_MODEL = "whisper-1";

/** Two minutes of speech is plenty for "what did I do", and 20 MB is a generous ceiling. */
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export const transcriptionConfigured = () => Boolean(process.env.STT_API_KEY);

export class TranscriptionError extends Error {}

/**
 * The words in an audio file, or a thrown error naming which part failed.
 *
 * Never returns an empty transcript as success: a recording that produced nothing is a failed
 * recording, and saving a log with no words in it would leave a row nobody can read and no
 * prompt to try again.
 */
export async function transcribe(audio: Buffer, mime: string): Promise<string> {
  const key = process.env.STT_API_KEY;
  if (!key) throw new TranscriptionError("no transcription service is configured");
  if (audio.byteLength === 0) throw new TranscriptionError("the recording was empty");
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    throw new TranscriptionError("that recording is too long — a minute or two is plenty");
  }

  /*
   * The extension matters to some providers and is derived from the MIME type the browser gave
   * us rather than assumed: iOS Safari records mp4/aac and everything else webm/opus.
   */
  const ext = /mp4|m4a|aac/.test(mime) ? "m4a" : /ogg/.test(mime) ? "ogg" : "webm";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `session.${ext}`);
  form.append("model", process.env.STT_MODEL ?? DEFAULT_MODEL);
  /* A gym is loud and the vocabulary is odd; a hint costs nothing and helps the nouns. */
  form.append("prompt", "Hyrox, sled push, sled pull, wall balls, burpee broad jumps, "
    + "farmers carry, SkiErg, rowing, kettlebell, RPE, reps, sets, kilos, splits.");

  const res = await fetch(process.env.STT_URL ?? DEFAULT_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    throw new TranscriptionError(`transcription failed (${res.status})`);
  }
  const body = (await res.json()) as { text?: string };
  const text = (body.text ?? "").trim();
  if (!text) throw new TranscriptionError("nothing could be heard in that recording");
  return text;
}
