import assert from 'node:assert/strict';
import test from 'node:test';
import { parseYouTubeUrl } from './youtube.ts';

test('accepts canonical watch URLs and normalizes them', () => {
  assert.deepEqual(parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), {
    normalizedUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', videoId: 'dQw4w9WgXcQ',
  });
});

test('accepts short URLs', () => {
  assert.equal(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=30').videoId, 'dQw4w9WgXcQ');
});

test('rejects lookalike domains and malformed IDs', () => {
  assert.throws(() => parseYouTubeUrl('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'), /Only youtube/);
  assert.throws(() => parseYouTubeUrl('https://www.youtube.com/watch?v=short'), /valid YouTube video ID/);
});
