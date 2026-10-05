import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cutSample, extractAudioChunks, probeMedia } from '../../container/media.js';
import { renderClip } from '../../container/render.js';
import { buildAssSubtitles, DEFAULT_CAPTION_SETTINGS } from '../../shared/captions.js';
import { computeCrop, outputSize } from '../../shared/reframe.js';
import type { RenderOptions, TranscriptDocument } from '../../shared/types.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;

test('container media pipeline: probe, chunked audio, sample cut and captioned vertical render (requires ffmpeg)', { skip: !hasFfmpeg }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipforge-render-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const signal = new AbortController().signal;

  const source = path.join(dir, 'source.mp4');
  const generated = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
  assert.equal(generated.status, 0, generated.stderr?.toString());

  const probe = await probeMedia(source, signal);
  assert.deepEqual([probe.width, probe.height, probe.hasAudio], [1280, 720, true]);
  assert.ok(probe.duration > 11.5);

  const chunks = await extractAudioChunks(source, path.join(dir, 'audio'), 5, signal);
  assert.equal(chunks.length, 3, 'a 12 s video split into 5 s chunks gives 3 files');
  for (const chunk of chunks) assert.ok((await fs.stat(chunk)).size > 1000);

  const sample = path.join(dir, 'sample.mp4');
  await cutSample(source, 2, 4, sample, signal);
  assert.ok((await probeMedia(sample, signal)).duration > 2);

  const transcript: TranscriptDocument = {
    language: 'en',
    segments: [{ id: 's1', text: 'Most people get this wrong.', start: 1, end: 4, words: [
      { word: 'Most', start: 1, end: 1.5 }, { word: 'people', start: 1.5, end: 2 }, { word: 'get', start: 2, end: 2.4 },
      { word: 'this', start: 2.4, end: 2.8 }, { word: 'wrong.', start: 2.8, end: 3.5 },
    ] }],
  };
  const options: RenderOptions = { resolution: '720p', fps: 30, format: 'mp4', codec: 'h264', aspectRatio: '9:16', quality: 'draft' };
  const size = outputSize(options.aspectRatio, options.resolution);
  const subtitlePath = path.join(dir, 'captions.ass');
  await fs.writeFile(subtitlePath, buildAssSubtitles(transcript, { start: 1, end: 5 }, DEFAULT_CAPTION_SETTINGS, { ...size, fontFamily: 'DejaVu Sans' }));

  const output = path.join(dir, 'out.mp4');
  const progress: number[] = [];
  await renderClip({
    source, outputPath: output, start: 1, duration: 4,
    crop: computeCrop(probe, options.aspectRatio, { panX: 30, panY: 50, zoom: 1.2 }), options,
    subtitlePath, watermarkText: 'ClipForge AI', captionFont: 'DejaVu Sans',
    audio: { noiseReduction: true, voiceEnhance: true, compressor: true, loudnessNorm: true, volume: 110 }, hasAudio: true,
  }, signal, (fraction) => progress.push(fraction));

  const rendered = await probeMedia(output, signal);
  assert.deepEqual([rendered.width, rendered.height, rendered.hasAudio], [720, 1280, true]);
  assert.ok(Math.abs(rendered.duration - 4) < 0.35, `duration ${rendered.duration}`);
  assert.ok(progress.length > 0 && Math.max(...progress) > 0.5, 'ffmpeg progress was reported');
});

test('container exec: renders are cancellable', { skip: !hasFfmpeg }, async () => {
  const controller = new AbortController();
  const promise = probeMedia('/definitely/missing.mp4', controller.signal);
  await assert.rejects(promise, (error: Error & { code?: string }) => error.code === 'MEDIA_INVALID');
  controller.abort();
  await assert.rejects(probeMedia('/x.mp4', controller.signal), (error: Error & { code?: string }) => error.code === 'JOB_CANCELLED');
});
