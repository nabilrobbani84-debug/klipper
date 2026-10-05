import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildAssSubtitles, DEFAULT_CAPTION_SETTINGS } from '../services/captions.js';
import { computeCrop, outputSize } from '../services/reframe.js';
import { extractAudio, FfmpegRenderProvider, probeMedia } from '../services/render.js';
import type { TranscriptDocument } from '../types.js';
import { testConfig } from './helpers.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;

test('ffmpeg pipeline renders a captioned, reframed vertical clip (requires ffmpeg)', { skip: !hasFfmpeg }, async (t) => {
  const config = testConfig({ FACE_DETECTION: 'false' });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipforge-render-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const source = path.join(dir, 'source.mp4');
  const generated = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
  assert.equal(generated.status, 0, generated.stderr?.toString());

  const probe = await probeMedia(config, source);
  assert.deepEqual([probe.width, probe.height, probe.hasAudio], [1280, 720, true]);
  assert.ok(probe.duration > 5.5);

  const audioPath = path.join(dir, 'audio.wav');
  await extractAudio(config, source, audioPath);
  assert.ok((await fs.stat(audioPath)).size > 1000);

  const transcript: TranscriptDocument = {
    language: 'en',
    segments: [{ id: 's1', text: 'Most people get this wrong.', start: 1, end: 4, words: [
      { word: 'Most', start: 1, end: 1.5 }, { word: 'people', start: 1.5, end: 2 }, { word: 'get', start: 2, end: 2.4 },
      { word: 'this', start: 2.4, end: 2.8 }, { word: 'wrong.', start: 2.8, end: 3.5 },
    ] }],
  };
  const options = { resolution: '720p' as const, fps: 30 as const, format: 'mp4' as const, codec: 'h264' as const, aspectRatio: '9:16' as const, quality: 'draft' as const };
  const size = outputSize(options.aspectRatio, options.resolution);
  const subtitlePath = path.join(dir, 'captions.ass');
  await fs.writeFile(subtitlePath, buildAssSubtitles(transcript, { start: 1, end: 5 }, DEFAULT_CAPTION_SETTINGS, size));

  const output = path.join(dir, 'out.mp4');
  let stderr = '';
  await new FfmpegRenderProvider(config, (text) => { stderr = text; }).renderClip({
    sourcePath: source, outputPath: output, start: 1, duration: 4,
    crop: computeCrop(probe, options.aspectRatio, { panX: 30, panY: 50, zoom: 1.2 }), options,
    subtitlePath, watermarkText: 'ClipForge AI',
    audio: { noiseReduction: true, voiceEnhance: true, compressor: true, loudnessNorm: true, volume: 110 }, hasAudio: true,
  }).catch((error) => assert.fail(`render failed: ${error.message}\n${stderr}`));

  const rendered = await probeMedia(config, output);
  assert.deepEqual([rendered.width, rendered.height, rendered.hasAudio], [720, 1280, true]);
  assert.ok(Math.abs(rendered.duration - 4) < 0.35, `duration ${rendered.duration}`);
});
