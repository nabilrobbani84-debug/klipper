import { AppError } from '../shared/errors.js';
import { outputSize, type CropRect } from '../shared/reframe.js';
import type { AudioSettings, RenderOptions } from '../shared/types.js';
import { BIN } from './media.js';
import { ExecError, run } from './exec.js';

/** Escapes a path for use inside an FFmpeg filtergraph option value. */
export function escapeFilterPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/,/g, '\\,').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

function sanitizeDrawtext(text: string): string {
  return text.replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40);
}

export interface RenderInput {
  /** Local path or URL (the r2.internal URL supports HTTP range, so FFmpeg seeks without a full download). */
  source: string;
  outputPath: string;
  start: number;
  duration: number;
  crop: CropRect;
  options: RenderOptions;
  subtitlePath?: string;
  watermarkText?: string | null;
  captionFont: string;
  audio: AudioSettings;
  hasAudio: boolean;
  threads?: number;
}

const PRESET: Record<RenderOptions['quality'], { preset: string; crf: number }> = {
  draft: { preset: 'veryfast', crf: 28 },
  standard: { preset: 'medium', crf: 22 },
  high: { preset: 'slow', crf: 19 },
  ultra: { preset: 'slow', crf: 17 },
};

/** Builds the full FFmpeg argument list (no shell). Exposed for tests. */
export function buildRenderArgs(input: RenderInput): string[] {
  const size = outputSize(input.options.aspectRatio, input.options.resolution);
  const { crop } = input;
  const video = [
    `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`,
    `scale=${size.width}:${size.height}:flags=lanczos`,
    'setsar=1',
    `fps=${input.options.fps}`,
  ];
  if (input.subtitlePath) video.push(`ass=filename='${escapeFilterPath(input.subtitlePath)}'`);
  if (input.watermarkText) {
    const fontSize = Math.round(size.height * 0.022);
    video.push(`drawtext=text='${sanitizeDrawtext(input.watermarkText)}':font='${input.captionFont}':fontcolor=white@0.55:fontsize=${fontSize}:x=w-tw-${Math.round(size.width * 0.04)}:y=${Math.round(size.height * 0.03)}:shadowcolor=black@0.5:shadowx=2:shadowy=2`);
  }
  video.push('format=yuv420p');

  const audio: string[] = [];
  if (input.audio.noiseReduction) audio.push('highpass=f=80', 'afftdn=nf=-25');
  if (input.audio.voiceEnhance) audio.push('equalizer=f=3000:t=q:w=1:g=3');
  if (input.audio.compressor) audio.push('acompressor=threshold=-18dB:ratio=3:attack=20:release=250');
  if (Number.isFinite(input.audio.volume) && input.audio.volume !== 100) audio.push(`volume=${Math.min(3, Math.max(0, input.audio.volume / 100)).toFixed(2)}`);
  if (input.audio.loudnessNorm) audio.push('loudnorm=I=-14:TP=-1.5:LRA=11');

  const { preset, crf } = PRESET[input.options.quality];
  const codecArgs = input.options.codec === 'h265'
    ? ['-c:v', 'libx265', '-preset', preset, '-crf', String(crf + 4), '-tag:v', 'hvc1']
    : ['-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-profile:v', 'high'];

  return [
    '-y', '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1',
    '-ss', input.start.toFixed(3), '-i', input.source, '-t', input.duration.toFixed(3),
    '-vf', video.join(','),
    ...(input.hasAudio ? ['-af', audio.length > 0 ? audio.join(',') : 'anull', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000'] : ['-an']),
    ...codecArgs,
    '-threads', String(input.threads ?? 0),
    '-movflags', '+faststart',
    '-f', input.options.format === 'mov' ? 'mov' : 'mp4',
    input.outputPath,
  ];
}

/** Runs FFmpeg and reports encode progress (0-1) parsed from `-progress pipe:1`. */
export async function renderClip(input: RenderInput, signal: AbortSignal, onProgress: (fraction: number) => void = () => undefined): Promise<void> {
  try {
    await run(BIN.ffmpeg, buildRenderArgs(input), {
      timeoutMs: 2 * 60 * 60_000,
      signal,
      onStdout: (text) => {
        const match = /out_time_us=(\d+)/.exec(text);
        if (match) onProgress(Math.min(1, Number(match[1]) / 1_000_000 / Math.max(0.1, input.duration)));
      },
    });
  } catch (error) {
    if (error instanceof ExecError) {
      if (error.aborted) throw new AppError('JOB_CANCELLED', 'Processing was cancelled.', 409);
      console.error(JSON.stringify({ level: 'error', message: 'ffmpeg failed', stderr: error.stderr }));
    }
    throw new AppError('RENDER_FAILED', 'Rendering failed. Please retry.', 422);
  }
}
