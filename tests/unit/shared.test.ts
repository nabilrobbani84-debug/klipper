import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRenderArgs, escapeFilterPath } from '../../container/render.js';
import { buildAssSubtitles, clipWords, DEFAULT_CAPTION_SETTINGS, formatAssTime, groupWords, toAssColor } from '../../shared/captions.js';
import { heuristicCandidates, normalizeClips } from '../../shared/clips.js';
import { capResolution, getPlanEntitlements } from '../../shared/plans.js';
import { parseRangeHeader } from '../../shared/range.js';
import { computeCrop, outputSize } from '../../shared/reframe.js';
import { mergeTranscripts, parseWhisperOutput } from '../../shared/transcript.js';
import type { TranscriptDocument } from '../../shared/types.js';
import { parseYouTubeUrl } from '../../shared/youtube.js';


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

test('plans: resolution is capped by plan', () => {
  assert.equal(capResolution('4K', getPlanEntitlements('FREE')), '720p');
  assert.equal(capResolution('1440p', getPlanEntitlements('CREATOR')), '1080p');
  assert.equal(capResolution('4K', getPlanEntitlements('PRO')), '4K');
  assert.equal(getPlanEntitlements('unknown').code, 'FREE');
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
  const args = buildRenderArgs({
    source: 'http://r2.internal/object?key=users%2Fu%2Fsources%2Fp.mp4', captionFont: 'DejaVu Sans', outputPath: '/tmp/out.mp4', start: 12.5, duration: 30, crop: { width: 608, height: 1080, x: 656, y: 0 },
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
  const silent = buildRenderArgs({ ...{ source: 'a', captionFont: 'DejaVu Sans', outputPath: 'b', start: 0, duration: 1, crop: { width: 2, height: 2, x: 0, y: 0 }, audio: { noiseReduction: false, voiceEnhance: false, compressor: false, loudnessNorm: false, volume: 100 } }, options: { resolution: '720p', fps: 24, format: 'mov', codec: 'h265', aspectRatio: '1:1', quality: 'draft' }, hasAudio: false });
  assert.ok(silent.includes('-an') && silent.includes('libx265') && silent.includes('mov'));
});

test('range: header parsing', () => {
  assert.equal(parseRangeHeader(undefined, 100), null);
  assert.deepEqual(parseRangeHeader('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepEqual(parseRangeHeader('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRangeHeader('bytes=-10', 100), { start: 90, end: 99 });
  assert.equal(parseRangeHeader('bytes=200-300', 100), 'unsatisfiable');
});

test('render: reads the remote source with frame-accurate input seeking and progress output', () => {
  const args = buildRenderArgs({
    source: 'http://r2.internal/object?key=k', outputPath: '/tmp/o.mp4', start: 5, duration: 10, crop: { width: 2, height: 2, x: 0, y: 0 },
    options: { resolution: '720p', fps: 30, format: 'mp4', codec: 'h264', aspectRatio: '9:16', quality: 'draft' }, captionFont: 'DejaVu Sans',
    audio: { noiseReduction: false, voiceEnhance: false, compressor: false, loudnessNorm: false, volume: 100 }, hasAudio: true,
  });
  assert.ok(args.indexOf('-ss') < args.indexOf('-i'), '-ss before -i');
  assert.equal(args[args.indexOf('-i') + 1], 'http://r2.internal/object?key=k');
  assert.ok(args.includes('-progress'));
  assert.equal(args[args.indexOf('-af') + 1], 'anull');
});

test('transcript: Workers AI whisper output is shifted onto the source timeline', () => {
  const doc = parseWhisperOutput({
    transcription_info: { language: 'id' },
    segments: [
      { start: 1, end: 2.5, text: ' Halo semua ', words: [{ word: ' Halo', start: 1, end: 1.4 }, { word: ' semua', start: 1.4, end: 2.5 }] },
      { start: 3, end: 4, text: 'noise', no_speech_prob: 0.95 },
      { start: 5, end: 5, text: 'empty range' },
    ],
  }, 240, 'c1');
  assert.equal(doc.language, 'id');
  assert.equal(doc.segments.length, 1);
  assert.deepEqual([doc.segments[0].start, doc.segments[0].end], [241, 242.5]);
  assert.deepEqual(doc.segments[0].words.map((w) => [w.word, w.start]), [['Halo', 241], ['semua', 241.4]]);
});

test('transcript: chunks merge in timeline order with renumbered ids', () => {
  const a = parseWhisperOutput({ segments: [{ start: 0, end: 2, text: 'first' }] }, 0, 'c0');
  const b = parseWhisperOutput({ language: 'en', segments: [{ start: 0, end: 2, text: 'second' }] }, 240, 'c1');
  const merged = mergeTranscripts([b, a]);
  assert.deepEqual(merged.segments.map((segment) => [segment.id, segment.text]), [['segment-1', 'first'], ['segment-2', 'second']]);
  assert.equal(merged.language, 'en');
});
