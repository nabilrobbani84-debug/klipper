import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMediaToken, createSessionToken, hashPassword, verifyMediaToken, verifyPassword, verifySessionToken } from '../auth.js';
import { loadConfig } from '../config.js';
import { capResolution, getPlanEntitlements } from '../plans.js';
import { buildAssSubtitles, clipWords, DEFAULT_CAPTION_SETTINGS, formatAssTime, groupWords, toAssColor } from '../services/captions.js';
import { heuristicCandidates, normalizeClips } from '../services/clips.js';
import { computeCrop, outputSize } from '../services/reframe.js';
import { buildRenderArgs, escapeFilterPath } from '../services/render.js';
import { LocalObjectStorage, parseRangeHeader } from '../services/storage.js';
import { parseWhisperJson } from '../services/transcription.js';
import { parseYouTubeUrl } from '../services/youtube.js';
import type { TranscriptDocument } from '../types.js';
import { testConfig } from './helpers.js';

const SECRET = 'unit-test-secret-value-that-is-long-enough';

function transcript(): TranscriptDocument {
  const segments = Array.from({ length: 20 }, (_, index) => {
    const start = index * 6;
    const text = index % 4 === 0 ? `Why do most people fail at step ${index}?` : `This is sentence number ${index} with some useful words.`;
    const tokens = text.split(' ');
    return {
      id: `s${index}`, text, start, end: start + 5.5,
      words: tokens.map((word, w) => ({ word, start: start + w * (5.5 / tokens.length), end: start + (w + 1) * (5.5 / tokens.length) })),
    };
  });
  return { language: 'en', segments };
}

test('youtube: accepts watch, short, shorts and embed URLs and normalises them', () => {
  assert.deepEqual(parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), { normalizedUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', videoId: 'dQw4w9WgXcQ' });
  assert.equal(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?si=abc').videoId, 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeUrl('https://youtube.com/shorts/dQw4w9WgXcQ').videoId, 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeUrl('https://m.youtube.com/embed/dQw4w9WgXcQ').videoId, 'dQw4w9WgXcQ');
});

test('youtube: rejects lookalike hosts, credentials, ports and bad IDs (SSRF guard)', () => {
  for (const url of [
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=short',
    'file:///etc/passwd',
    'http://169.254.169.254/latest/meta-data',
    'not a url',
  ]) {
    assert.throws(() => parseYouTubeUrl(url), (error: Error & { code?: string }) => error.code === 'INVALID_YOUTUBE_URL', url);
  }
});

test('config: fails fast on missing/weak secrets and incomplete storage', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'test' }), /AUTH_SECRET/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', AUTH_SECRET: 'x'.repeat(40) }), /DATABASE_URL/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', AUTH_SECRET: 'change-me-change-me-change-me-change-me', DATABASE_URL: 'postgres://x' }), /random production secret/);
  assert.throws(() => loadConfig({ NODE_ENV: 'test', AUTH_SECRET: 'x'.repeat(40), STORAGE_DRIVER: 's3' }), /STORAGE_DRIVER=s3/);
  assert.equal(testConfig().ALLOW_DEV_AUTH, false);
});

test('auth: password hashing and verification', async () => {
  const hash = await hashPassword('correct horse battery');
  assert.ok(await verifyPassword('correct horse battery', hash));
  assert.equal(await verifyPassword('wrong password!!', hash), false);
  assert.equal(await verifyPassword('anything', 'garbage'), false);
});

test('auth: session tokens are signed and expire', () => {
  const { token } = createSessionToken({ id: 'u1', email: 'a@b.c', role: 'user' }, SECRET, 60);
  assert.equal(verifySessionToken(token, SECRET)?.id, 'u1');
  assert.equal(verifySessionToken(token, `${SECRET}x`), null);
  assert.equal(verifySessionToken(`${token}x`, SECRET), null);
  const expired = createSessionToken({ id: 'u1' }, SECRET, -10).token;
  assert.equal(verifySessionToken(expired, SECRET), null);
});

test('auth: media tokens are scoped to the owner key prefix', () => {
  const token = createMediaToken({ key: 'users/u1/projects/p/exports/x.mp4', userId: 'u1' }, SECRET, 60);
  assert.equal(verifyMediaToken(token, SECRET)?.key, 'users/u1/projects/p/exports/x.mp4');
  const foreign = createMediaToken({ key: 'users/u2/sources/p.mp4', userId: 'u1' }, SECRET, 60);
  assert.equal(verifyMediaToken(foreign, SECRET), null);
  assert.equal(verifyMediaToken(createMediaToken({ key: 'users/u1/a.mp4', userId: 'u1' }, SECRET, -1), SECRET), null);
});

test('plans: resolution is capped by plan', () => {
  assert.equal(capResolution('4K', getPlanEntitlements('FREE')), '720p');
  assert.equal(capResolution('1440p', getPlanEntitlements('CREATOR')), '1080p');
  assert.equal(capResolution('4K', getPlanEntitlements('PRO')), '4K');
  assert.equal(getPlanEntitlements('unknown').code, 'FREE');
});

test('whisper: parses JSON with word timestamps and drops empty segments', () => {
  const doc = parseWhisperJson({
    language: 'en',
    segments: [
      { text: ' Hello world ', start: 0, end: 1.2, words: [{ word: ' Hello', start: 0, end: 0.5, probability: 0.9 }, { word: ' world', start: 0.5, end: 1.2 }] },
      { text: '   ', start: 1.2, end: 2 },
    ],
  });
  assert.equal(doc.segments.length, 1);
  assert.equal(doc.segments[0].text, 'Hello world');
  assert.deepEqual(doc.segments[0].words.map((w) => w.word), ['Hello', 'world']);
});

test('clips: snaps to sentence boundaries, removes overlaps and limits count', () => {
  const doc = transcript();
  const clips = normalizeClips([
    { start: 13, end: 50, score: 90, title: 'A', hook: 'h', reason: 'r' },
    { start: 14, end: 49, score: 85, title: 'Duplicate', hook: 'h', reason: 'r' },
    { start: 61, end: 100, score: 80, title: 'B', hook: 'h', reason: 'r' },
    { start: 5, end: 2, score: 99, title: 'Invalid', hook: 'h', reason: 'r' },
  ], doc, { preferredDuration: 40, requestedClipCount: 5 });
  assert.deepEqual(clips.map((clip) => clip.title), ['A', 'B']);
  assert.equal(clips[0].start, 12); // start of the segment containing 13s
  assert.equal(clips[0].end, 53.5); // end of the segment containing 50s
  assert.ok(clips.every((clip) => clip.transcript.length > 0 && clip.duration === Number((clip.end - clip.start).toFixed(3))));
});

test('clips: heuristic detector produces requested non-overlapping clips', () => {
  const doc = transcript();
  const options = { preferredDuration: 30, requestedClipCount: 3 };
  const clips = normalizeClips(heuristicCandidates(doc, options), doc, options);
  assert.equal(clips.length, 3);
  for (let i = 1; i < clips.length; i += 1) assert.ok(clips[i].start >= clips[i - 1].start);
});

test('captions: colour conversion, time format and grouping', () => {
  assert.equal(toAssColor('#FACC15'), '&H0015CCFA');
  assert.equal(toAssColor('rgba(0,0,0,0.6)'), '&H66000000');
  assert.equal(formatAssTime(3725.456), '1:02:05.46');
  const groups = groupWords([
    { word: 'one', start: 0, end: 0.2 }, { word: 'two.', start: 0.2, end: 0.4 }, { word: 'three', start: 0.5, end: 0.7 },
    { word: 'four', start: 2, end: 2.2 },
  ], 4);
  assert.deepEqual(groups.map((g) => g.map((w) => w.word)), [['one', 'two.'], ['three'], ['four']]);
});

test('captions: builds karaoke ASS relative to the clip start', () => {
  const doc = transcript();
  const words = clipWords(doc, 24, 30);
  assert.ok(words[0].start >= 0 && words[words.length - 1].end <= 6);
  const ass = buildAssSubtitles(doc, { start: 24, end: 30 }, DEFAULT_CAPTION_SETTINGS, { width: 1080, height: 1920 });
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /Dialogue: 0,0:00:00\.00/);
  assert.match(ass, /\\c&H0015CCFA&/);
  assert.ok(ass.includes('WHY'), 'uppercase transform applied');
  const plain = buildAssSubtitles(doc, { start: 24, end: 30 }, { ...DEFAULT_CAPTION_SETTINGS, karaokeEffect: false, uppercase: false }, { width: 1080, height: 1920 });
  assert.ok(!plain.includes('\\c&H'));
});

test('reframe: output sizes and crop rectangles stay inside the source', () => {
  assert.deepEqual(outputSize('9:16', '1080p'), { width: 1080, height: 1920 });
  assert.deepEqual(outputSize('16:9', '720p'), { width: 1280, height: 720 });
  assert.deepEqual(outputSize('4:5', '1080p'), { width: 1080, height: 1350 });
  const source = { width: 1920, height: 1080 };
  assert.deepEqual(computeCrop(source, '9:16', { panX: 50, panY: 50, zoom: 1 }), { width: 608, height: 1080, x: 656, y: 0 });
  assert.equal(computeCrop(source, '9:16', { panX: 0, panY: 50, zoom: 1 }).x, 0);
  assert.equal(computeCrop(source, '9:16', { panX: 100, panY: 50, zoom: 1 }).x, 1920 - 608);
  const zoomed = computeCrop(source, '9:16', { panX: 50, panY: 30, zoom: 2 });
  assert.ok(zoomed.width === 304 && zoomed.height === 540 && zoomed.y >= 0 && zoomed.y + zoomed.height <= 1080);
  assert.deepEqual(computeCrop(source, '16:9', { panX: 50, panY: 50, zoom: 1 }), { width: 1920, height: 1080, x: 0, y: 0 });
});

test('render: builds an ffmpeg command with crop, captions, watermark and audio chain', () => {
  const config = testConfig();
  const args = buildRenderArgs(config, {
    sourcePath: '/tmp/in.mp4', outputPath: '/tmp/out.mp4', start: 12.5, duration: 30, crop: { width: 608, height: 1080, x: 656, y: 0 },
    options: { resolution: '1080p', fps: 30, format: 'mp4', codec: 'h264', aspectRatio: '9:16', quality: 'standard' },
    subtitlePath: '/tmp/job:1/captions.ass', watermarkText: "ClipForge AI';rm -rf", audio: { noiseReduction: true, voiceEnhance: false, compressor: false, loudnessNorm: true, volume: 100 }, hasAudio: true,
  });
  const vf = args[args.indexOf('-vf') + 1];
  assert.match(vf, /^crop=608:1080:656:0,scale=1080:1920/);
  assert.ok(vf.includes("ass=filename='/tmp/job\\:1/captions.ass'"));
  assert.ok(vf.includes("drawtext=text='ClipForge AIrm -rf'"), 'watermark is sanitised');
  assert.ok(args.includes('libx264') && args.includes('aac'));
  assert.match(args[args.indexOf('-af') + 1], /loudnorm/);
  assert.equal(escapeFilterPath("a:b'c,d"), "a\\:b\\'c\\,d");
  const silent = buildRenderArgs(config, { ...{ sourcePath: 'a', outputPath: 'b', start: 0, duration: 1, crop: { width: 2, height: 2, x: 0, y: 0 }, audio: { noiseReduction: false, voiceEnhance: false, compressor: false, loudnessNorm: false, volume: 100 } }, options: { resolution: '720p', fps: 24, format: 'mov', codec: 'h265', aspectRatio: '1:1', quality: 'draft' }, hasAudio: false });
  assert.ok(silent.includes('-an') && silent.includes('libx265') && silent.includes('mov'));
});

test('storage: range parsing', () => {
  assert.equal(parseRangeHeader(undefined, 100), null);
  assert.deepEqual(parseRangeHeader('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepEqual(parseRangeHeader('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRangeHeader('bytes=-10', 100), { start: 90, end: 99 });
  assert.equal(parseRangeHeader('bytes=200-300', 100), 'unsatisfiable');
});

test('storage: local adapter round-trips and blocks traversal', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clipforge-storage-'));
  const storage = new LocalObjectStorage({ STORAGE_DIR: root });
  const file = path.join(root, 'in.txt');
  await fs.writeFile(file, 'hello world');
  const stored = await storage.put(file, 'users/u1/a/b.txt', 'text/plain');
  assert.equal(stored.sizeBytes, 11);
  assert.equal(await storage.size('users/u1/a/b.txt'), 11);
  const chunks: Buffer[] = [];
  for await (const chunk of await storage.open('users/u1/a/b.txt', { start: 6, end: 10 })) chunks.push(chunk as Buffer);
  assert.equal(Buffer.concat(chunks).toString(), 'world');
  await assert.rejects(storage.open('../../etc/passwd'));
  await storage.deletePrefix('users/u1/');
  assert.equal(await storage.size('users/u1/a/b.txt'), null);
  await fs.rm(root, { recursive: true, force: true });
});
