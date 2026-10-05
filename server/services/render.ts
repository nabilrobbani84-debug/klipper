import type { AppConfig } from '../config.js';
import { AppError } from '../errors.js';
import type { AudioSettings, RenderOptions } from '../types.js';
import { ExecError, run } from './exec.js';
import type { CropRect, Size } from './reframe.js';
import { outputSize } from './reframe.js';

export interface ProbeResult extends Size { duration: number; hasAudio: boolean; }

export async function probeMedia(config: AppConfig, path: string, signal?: AbortSignal): Promise<ProbeResult> {
  try {
    const { stdout } = await run(config.FFPROBE_BIN, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path], { timeoutMs: 60_000, signal });
    const data = JSON.parse(stdout) as { streams?: Array<Record<string, unknown>>; format?: { duration?: string } };
    const video = data.streams?.find((stream) => stream.codec_type === 'video');
    if (!video) throw new AppError('MEDIA_INVALID', 'The source file has no video stream.', 422);
    const rotation = Math.abs(Number((video.tags as Record<string, unknown> | undefined)?.rotate ?? 0));
    const width = Number(video.width);
    const height = Number(video.height);
    return {
      width: rotation === 90 || rotation === 270 ? height : width,
      height: rotation === 90 || rotation === 270 ? width : height,
      duration: Number(data.format?.duration ?? video.duration ?? 0),
      hasAudio: Boolean(data.streams?.some((stream) => stream.codec_type === 'audio')),
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('MEDIA_INVALID', 'The source media could not be read.', 422);
  }
}

export async function extractAudio(config: AppConfig, sourcePath: string, outputPath: string, signal?: AbortSignal): Promise<void> {
  try {
    await run(config.FFMPEG_BIN, ['-y', '-hide_banner', '-loglevel', 'error', '-i', sourcePath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outputPath], { timeoutMs: 60 * 60_000, signal });
  } catch (error) {
    if (error instanceof ExecError && error.aborted) throw new AppError('JOB_CANCELLED', 'Processing was cancelled.', 409);
    throw new AppError('AUDIO_EXTRACTION_FAILED', 'Audio extraction failed. The video may not contain an audio track.', 422);
  }
}

/** Escapes a path for use inside an FFmpeg filtergraph option value. */
export function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/,/g, '\\,').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

function sanitizeDrawtext(text: string): string {
  return text.replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40);
}

export interface RenderInput {
  sourcePath: string;
  outputPath: string;
  start: number;
  duration: number;
  crop: CropRect;
  options: RenderOptions;
  subtitlePath?: string;
  watermarkText?: string;
  audio: AudioSettings;
  hasAudio: boolean;
}

const PRESET: Record<RenderOptions['quality'], { preset: string; crf: number }> = {
  draft: { preset: 'veryfast', crf: 28 },
  standard: { preset: 'medium', crf: 22 },
  high: { preset: 'slow', crf: 19 },
  ultra: { preset: 'slow', crf: 17 },
};

/** Builds the full FFmpeg argument list. Exposed for tests so the filter graph can be verified without encoding. */
export function buildRenderArgs(config: AppConfig, input: RenderInput): string[] {
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
    video.push(`drawtext=text='${sanitizeDrawtext(input.watermarkText)}':font='${config.CAPTION_FONT}':fontcolor=white@0.55:fontsize=${fontSize}:x=w-tw-${Math.round(size.width * 0.04)}:y=${Math.round(size.height * 0.03)}:shadowcolor=black@0.5:shadowx=2:shadowy=2`);
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
    '-y', '-hide_banner', '-loglevel', 'error',
    '-ss', input.start.toFixed(3), '-i', input.sourcePath, '-t', input.duration.toFixed(3),
    '-vf', video.join(','),
    ...(input.hasAudio ? ['-af', audio.length > 0 ? audio.join(',') : 'anull', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000'] : ['-an']),
    ...codecArgs,
    '-threads', String(config.FFMPEG_THREADS),
    '-movflags', '+faststart',
    '-f', input.options.format === 'mov' ? 'mov' : 'mp4',
    input.outputPath,
  ];
}

export interface RenderProvider {
  renderClip(input: RenderInput, signal?: AbortSignal): Promise<void>;
}

export class FfmpegRenderProvider implements RenderProvider {
  constructor(private readonly config: AppConfig, private readonly onError: (stderr: string) => void = () => undefined) {}

  async renderClip(input: RenderInput, signal?: AbortSignal): Promise<void> {
    try {
      await run(this.config.FFMPEG_BIN, buildRenderArgs(this.config, input), { timeoutMs: 2 * 60 * 60_000, signal });
    } catch (error) {
      if (error instanceof ExecError) {
        if (error.aborted) throw new AppError('JOB_CANCELLED', 'Processing was cancelled.', 409);
        this.onError(error.stderr);
      }
      throw new AppError('RENDER_FAILED', 'Rendering failed. Please retry.', 422);
    }
  }
}
