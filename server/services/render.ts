import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AppConfig } from '../config.js';
import { AppError } from '../errors.js';

const execFileAsync = promisify(execFile);

export interface RenderProvider {
  renderClip(input: { sourcePath: string; outputPath: string; start: number; duration: number; aspectRatio: '9:16' | '16:9' | '1:1' | '4:5'; quality: 'draft' | 'standard' | 'high' | 'ultra' }): Promise<void>;
}

const dimensions: Record<string, [number, number]> = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350] };
const crf: Record<string, number> = { draft: 30, standard: 23, high: 18, ultra: 15 };

export class FfmpegRenderProvider implements RenderProvider {
  constructor(private readonly config: AppConfig) {}

  async renderClip(input: Parameters<RenderProvider['renderClip']>[0]) {
    const [width, height] = dimensions[input.aspectRatio];
    try {
      await execFileAsync(this.config.FFMPEG_BIN, [
        '-y', '-ss', input.start.toFixed(3), '-i', input.sourcePath, '-t', input.duration.toFixed(3),
        '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=30`,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf[input.quality]), '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', input.outputPath,
      ], { timeout: 20 * 60_000, maxBuffer: 4 * 1024 * 1024 });
    } catch {
      throw new AppError('RENDER_FAILED', 'Video rendering failed. Please retry the export.', 422);
    }
  }
}
