import { AppError } from '../shared/errors.js';
import { parseWhisperOutput, type WhisperOutput } from '../shared/transcript.js';
import type { AudioChunk, TranscriptDocument } from '../shared/types.js';
import { base64Encode } from './crypto.js';
import type { Env } from './env.js';

/** Transcribes one audio chunk from R2 with Workers AI Whisper, shifted onto the source timeline. */
export async function transcribeChunk(env: Env, chunk: AudioChunk, index: number): Promise<TranscriptDocument> {
  if (!env.AI) throw new AppError('AI_NOT_CONFIGURED', 'Workers AI is not bound to this Worker.', 503);
  const object = await env.MEDIA_BUCKET.get(chunk.key);
  if (!object) throw new AppError('AUDIO_MISSING', 'Extracted audio could not be found. Please retry the job.', 422);
  const audio = base64Encode(await object.arrayBuffer());
  const inputs: Record<string, unknown> = { audio, task: 'transcribe', vad_filter: true, condition_on_previous_text: false };
  if (env.WHISPER_LANGUAGE) inputs.language = env.WHISPER_LANGUAGE;
  let raw: WhisperOutput;
  try {
    raw = (await env.AI.run(env.WHISPER_MODEL || '@cf/openai/whisper-large-v3-turbo', inputs)) as WhisperOutput;
  } catch {
    throw new AppError('TRANSCRIPTION_FAILED', 'Speech-to-text failed for part of the video. Please retry.', 503, true);
  }
  return parseWhisperOutput(raw, chunk.offset, `c${index}`);
}
