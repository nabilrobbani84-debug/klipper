import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import '../../worker/env.js';
import { runMaintenance } from '../../worker/cron.js';
import { Repository } from '../../worker/db.js';
import { onAcquired, onContainerProgress, onRendered, processMessage } from '../../worker/pipeline.js';
import type { TranscriptDocument } from '../../shared/types.js';

const BASE = 'https://clipforge.test';

type Envelope<T = Record<string, unknown>> = { success: boolean; data: T; error: { code: string; message: string } | null };

async function call<T = Record<string, unknown>>(path: string, init: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const response = await exports.default.fetch(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(init.headers ?? {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: (text ? JSON.parse(text) : null) as Envelope<T> };
}

async function register(email: string, password = 'correct-horse-battery') {
  const result = await call<{ token: string; user: { id: string; role: string } }>('/api/v1/auth/register', { method: 'POST', body: { email, password } });
  expect(result.status).toBe(201);
  return { token: result.body.data.token, id: result.body.data.user.id, role: result.body.data.user.role };
}

function transcript(): TranscriptDocument {
  const segments = Array.from({ length: 30 }, (_, index) => {
    const start = index * 5;
    const text = index % 5 === 0 ? `Why do most creators fail at part ${index}?` : `This is a useful sentence number ${index} about growth.`;
    const tokens = text.split(' ');
    return { id: `s${index}`, text, start, end: start + 4.5, words: tokens.map((word, w) => ({ word, start: start + w * (4.5 / tokens.length), end: start + (w + 1) * (4.5 / tokens.length) })) };
  });
  return { language: 'en', segments };
}

const VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

describe('ClipForge Worker API', () => {
  let alice: { token: string; id: string; role: string };
  let bob: { token: string; id: string; role: string };
  let firstJobId = '';
  let firstProjectId = '';

  it('serves health and sets security headers on the API', async () => {
    const health = await exports.default.fetch(`${BASE}/health`);
    expect(health.status).toBe(200);
    const config = await call('/api/v1/config');
    expect(config.status).toBe(200);
    expect(config.body.data.registrationOpen).toBe(true);
    expect(config.body.data.googleAuth).toBe(false);
    expect(config.headers.get('x-content-type-options')).toBe('nosniff');
    expect(config.headers.get('x-request-id')).toBeTruthy();
  });

  it('registers users, rejects duplicates and promotes ADMIN_EMAILS', async () => {
    alice = await register('alice@example.com');
    bob = await register('bob@example.com');
    expect(alice.role).toBe('user');
    const duplicate = await call('/api/v1/auth/register', { method: 'POST', body: { email: 'ALICE@example.com', password: 'another-password' } });
    expect(duplicate.status).toBe(409);
    const weak = await call('/api/v1/auth/register', { method: 'POST', body: { email: 'weak@example.com', password: 'short' } });
    expect(weak.status).toBe(400);
    const admin = await register('admin@example.com');
    expect(admin.role).toBe('admin');
  });

  it('logs in with the right password only and exposes the session user', async () => {
    expect((await call('/api/v1/auth/login', { method: 'POST', body: { email: 'alice@example.com', password: 'wrong-password!' } })).status).toBe(401);
    expect((await call('/api/v1/auth/login', { method: 'POST', body: { email: 'nobody@example.com', password: 'whatever-123' } })).status).toBe(401);
    const login = await call<{ token: string }>('/api/v1/auth/login', { method: 'POST', body: { email: 'alice@example.com', password: 'correct-horse-battery' } });
    expect(login.status).toBe(200);
    const me = await call<{ email: string; usage: { plan: { code: string }; creditsRemaining: number } }>('/api/v1/auth/me', { token: login.body.data.token });
    expect(me.body.data.email).toBe('alice@example.com');
    expect(me.body.data.usage.plan.code).toBe('FREE');
    expect(me.body.data.usage.creditsRemaining).toBe(3);
  });

  it('rejects unauthenticated and forged sessions; logout revokes the session', async () => {
    expect((await call('/api/v1/projects')).status).toBe(401);
    expect((await call('/api/v1/projects', { token: 'forged-token' })).status).toBe(401);
    const temp = await register('temp@example.com');
    expect((await call('/api/v1/projects', { token: temp.token })).status).toBe(200);
    expect((await call('/api/v1/auth/logout', { method: 'POST', token: temp.token })).status).toBe(200);
    expect((await call('/api/v1/projects', { token: temp.token })).status).toBe(401);
  });

  it('validates YouTube URLs and rights confirmation server-side', async () => {
    const bad = await call('/api/v1/projects', { method: 'POST', token: alice.token, body: { youtubeUrl: 'https://evil.example/watch?v=dQw4w9WgXcQ', rightsConfirmed: true } });
    expect(bad.status).toBe(400);
    expect(bad.body.error?.code).toBe('INVALID_YOUTUBE_URL');
    const ssrf = await call('/api/v1/projects', { method: 'POST', token: alice.token, body: { youtubeUrl: 'http://169.254.169.254/latest/meta-data', rightsConfirmed: true } });
    expect(ssrf.status).toBe(400);
    const noRights = await call('/api/v1/projects', { method: 'POST', token: alice.token, body: { youtubeUrl: VIDEO } });
    expect(noRights.status).toBe(400);
    const tooMany = await call('/api/v1/projects', { method: 'POST', token: alice.token, body: { youtubeUrl: VIDEO, rightsConfirmed: true, requestedClipCount: 10 } });
    expect(tooMany.status).toBe(402);
  });

  it('queues an async analysis job (202) and enforces plan concurrency', async () => {
    const created = await call<{ projectId: string; jobId: string; status: string }>('/api/v1/projects', { method: 'POST', token: alice.token, body: { youtubeUrl: VIDEO, rightsConfirmed: true, requestedClipCount: 3 } });
    expect(created.status).toBe(202);
    expect(created.body.data.status).toBe('QUEUED');
    firstJobId = created.body.data.jobId;
    firstProjectId = created.body.data.projectId;
    const job = await call<{ state: string; kind: string }>(`/api/v1/jobs/${firstJobId}`, { token: alice.token });
    expect(job.body.data.kind).toBe('analysis');
    const second = await call('/api/v1/projects', { method: 'POST', token: alice.token, body: { youtubeUrl: VIDEO, rightsConfirmed: true } });
    expect(second.status).toBe(429);
    expect(second.body.error?.code).toBe('CONCURRENCY_LIMIT');
  });

  it('isolates users: nobody can read or cancel another user\'s project or job', async () => {
    expect((await call(`/api/v1/projects/${firstProjectId}`, { token: bob.token })).status).toBe(404);
    expect((await call(`/api/v1/jobs/${firstJobId}`, { token: bob.token })).status).toBe(404);
    expect((await call(`/api/v1/jobs/${firstJobId}/cancel`, { method: 'POST', token: bob.token })).status).toBe(404);
    expect((await call(`/api/v1/projects/${firstProjectId}`, { method: 'DELETE', token: bob.token })).status).toBe(404);
  });

  it('cancels a job and refunds the credit; retry reserves it again', async () => {
    const cancel = await call(`/api/v1/jobs/${firstJobId}/cancel`, { method: 'POST', token: alice.token });
    expect(cancel.status).toBe(200);
    const usage = await call<{ creditsRemaining: number }>('/api/v1/account/usage', { token: alice.token });
    expect(usage.body.data.creditsRemaining).toBe(3);
    expect((await call(`/api/v1/jobs/${firstJobId}/cancel`, { method: 'POST', token: alice.token })).status).toBe(409);
    const retry = await call(`/api/v1/jobs/${firstJobId}/retry`, { method: 'POST', token: alice.token });
    expect(retry.status).toBe(202);
    const after = await call<{ creditsRemaining: number }>('/api/v1/account/usage', { token: alice.token });
    expect(after.body.data.creditsRemaining).toBe(2);
  });

  it('runs the analysis pipeline from container hand-off to saved clips (heuristic detector)', async () => {
    const repo = new Repository(env.DB);
    const job = (await repo.getJobById(firstJobId))!;
    await repo.setJobContainer(job.id, 'container-test-1');
    expect(await onContainerProgress(env, job, { state: 'DOWNLOADING', progress: 12, message: 'Downloading…' })).toBe(true);

    // The container stored the audio; transcription output is simulated by writing the merged transcript.
    await onAcquired(env, job, {
      metadata: { sourceUrl: VIDEO, sourceId: 'dQw4w9WgXcQ', title: 'How creators grow', channel: 'Test', durationSeconds: 150, thumbnailUrl: null, description: null, width: 1920, height: 1080 },
      width: 1920, height: 1080, duration: 150, hasAudio: true,
      chunks: [{ key: `users/${alice.id}/projects/${firstProjectId}/audio/chunk-0000.mp3`, offset: 0, duration: 150 }],
    });
    expect((await repo.getJobById(firstJobId))!.state).toBe('TRANSCRIBING');
    const transcriptKey = `users/${alice.id}/projects/${firstProjectId}/transcript.json`;
    await env.MEDIA_BUCKET.put(transcriptKey, JSON.stringify(transcript()));
    await repo.saveTranscriptKey(firstProjectId, transcriptKey);
    await env.MEDIA_BUCKET.put(`users/${alice.id}/sources/${firstProjectId}.mp4`, new Uint8Array(1000).fill(7));

    await processMessage(env, { type: 'analysis.detect', jobId: firstJobId });
    const done = await call<{ state: string; progress: number }>(`/api/v1/jobs/${firstJobId}`, { token: alice.token });
    expect(done.body.data.state).toBe('COMPLETED');
    const project = await call<{ status: string; clips: Array<{ id: string; start: number; end: number; editor: { reframing: { mode: string } } }>; transcript: { segments: unknown[] }; sourceMediaUrl: string; name: string }>(`/api/v1/projects/${firstProjectId}`, { token: alice.token });
    expect(project.body.data.status).toBe('READY');
    expect(project.body.data.name).toBe('How creators grow');
    expect(project.body.data.clips.length).toBe(3);
    expect(project.body.data.clips[0].editor.reframing.mode).toBe('face');
    expect(project.body.data.transcript.segments.length).toBeGreaterThan(0);
    expect(project.body.data.sourceMediaUrl).toMatch(/^https:\/\/clipforge\.test\/media\//);
  });

  it('persists clip edits and validates ranges', async () => {
    const project = await call<{ clips: Array<{ id: string; start: number }> }>(`/api/v1/projects/${firstProjectId}`, { token: alice.token });
    const clip = project.body.data.clips[0];
    const patched = await call<{ duration: number; editor: { captions: { karaokeEffect: boolean }; aspectRatio: string } }>(`/api/v1/projects/${firstProjectId}/clips/${clip.id}`, {
      method: 'PATCH', token: alice.token,
      body: { start: clip.start, end: clip.start + 20, editor: { aspectRatio: '1:1', captions: { karaokeEffect: false, fontSize: 32 } } },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data.duration).toBe(20);
    expect(patched.body.data.editor.aspectRatio).toBe('1:1');
    expect(patched.body.data.editor.captions.karaokeEffect).toBe(false);
    const invalid = await call(`/api/v1/projects/${firstProjectId}/clips/${clip.id}`, { method: 'PATCH', token: alice.token, body: { start: 10, end: 10.2 } });
    expect(invalid.status).toBe(400);
    expect((await call(`/api/v1/projects/${firstProjectId}/clips/${clip.id}`, { method: 'PATCH', token: bob.token, body: { title: 'hijack' } })).status).toBe(404);
  });

  it('queues a render with plan-capped settings and serves the export through signed range URLs', async () => {
    const project = await call<{ clips: Array<{ id: string }> }>(`/api/v1/projects/${firstProjectId}`, { token: alice.token });
    const clipId = project.body.data.clips[0].id;
    const render = await call<{ jobId: string; options: { resolution: string; codec: string; aspectRatio: string } }>(`/api/v1/projects/${firstProjectId}/clips/${clipId}/exports`, {
      method: 'POST', token: alice.token, body: { resolution: '4K', codec: 'h265', fps: 60 },
    });
    expect(render.status).toBe(202);
    expect(render.body.data.options.resolution).toBe('720p');
    expect(render.body.data.options.codec).toBe('h264');
    expect(render.body.data.options.aspectRatio).toBe('1:1');

    const repo = new Repository(env.DB);
    const job = (await repo.getJobById(render.body.data.jobId))!;
    const key = `users/${alice.id}/projects/${firstProjectId}/exports/${job.id}.mp4`;
    await env.MEDIA_BUCKET.put(key, new TextEncoder().encode('0123456789'), { httpMetadata: { contentType: 'video/mp4' } });
    await expect(onRendered(env, job, { key: `users/${bob.id}/x.mp4`, sizeBytes: 10, width: 720, height: 720, contentType: 'video/mp4' })).rejects.toThrow();
    await onRendered(env, job, { key, sizeBytes: 10, width: 720, height: 720, contentType: 'video/mp4' });

    const exportResult = await call<{ downloadUrl: string; previewUrl: string; sizeBytes: number }>(`/api/v1/jobs/${job.id}/export`, { token: alice.token });
    expect(exportResult.status).toBe(200);
    const list = await call<unknown[]>('/api/v1/exports', { token: alice.token });
    expect(list.body.data.length).toBe(1);
    expect((await call<unknown[]>('/api/v1/exports', { token: bob.token })).body.data.length).toBe(0);

    const full = await exports.default.fetch(exportResult.body.data.previewUrl);
    expect(full.status).toBe(200);
    expect(await full.text()).toBe('0123456789');
    const partial = await exports.default.fetch(exportResult.body.data.previewUrl, { headers: { range: 'bytes=2-4' } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe('bytes 2-4/10');
    expect(await partial.text()).toBe('234');
    const download = await exports.default.fetch(exportResult.body.data.downloadUrl);
    expect(download.headers.get('content-disposition')).toContain('attachment');
    expect((await exports.default.fetch(`${exportResult.body.data.previewUrl}x`)).status).toBe(403);
  });

  it('restricts admin routes to admins and lets admins manage plans', async () => {
    expect((await call('/api/v1/admin/overview', { token: alice.token })).status).toBe(403);
    const login = await call<{ token: string }>('/api/v1/auth/login', { method: 'POST', body: { email: 'admin@example.com', password: 'correct-horse-battery' } });
    const adminToken = login.body.data.token;
    const overview = await call<{ users: number; projects: number }>('/api/v1/admin/overview', { token: adminToken });
    expect(overview.status).toBe(200);
    expect(overview.body.data.users).toBeGreaterThanOrEqual(3);
    const users = await call<Array<{ id: string; email: string }>>('/api/v1/admin/users?search=bob', { token: adminToken });
    expect(users.body.data[0].email).toBe('bob@example.com');
    expect((await call(`/api/v1/admin/users/${bob.id}`, { method: 'PATCH', token: adminToken, body: { plan: 'PRO' } })).status).toBe(200);
    const bobUsage = await call<{ plan: { code: string } }>('/api/v1/account/usage', { token: bob.token });
    expect(bobUsage.body.data.plan.code).toBe('PRO');
    expect((await call(`/api/v1/admin/users/${bob.id}`, { method: 'PATCH', token: adminToken, body: { suspended: true } })).status).toBe(200);
    expect((await call('/api/v1/projects', { token: bob.token })).status).toBe(401);
    const jobs = await call<unknown[]>('/api/v1/admin/jobs', { token: adminToken });
    expect(jobs.body.data.length).toBeGreaterThan(0);
  });

  it('fails stalled jobs during maintenance and refunds analysis credits', async () => {
    const created = await call<{ jobId: string }>('/api/v1/projects', { method: 'POST', token: alice.token, body: { youtubeUrl: 'https://youtu.be/aqz-KE-bpKQ', rightsConfirmed: true } });
    expect(created.status).toBe(202);
    const before = (await call<{ creditsRemaining: number }>('/api/v1/account/usage', { token: alice.token })).body.data.creditsRemaining;
    await runMaintenance(env, Date.now() + 60 * 60_000);
    const job = await call<{ state: string; errorCode: string }>(`/api/v1/jobs/${created.body.data.jobId}`, { token: alice.token });
    expect(job.body.data.state).toBe('FAILED');
    expect(job.body.data.errorCode).toBe('WORKER_TIMEOUT');
    const after = (await call<{ creditsRemaining: number }>('/api/v1/account/usage', { token: alice.token })).body.data.creditsRemaining;
    expect(after).toBe(before + 1);
  });

  it('deletes a project with its stored media', async () => {
    const deleted = await call(`/api/v1/projects/${firstProjectId}`, { method: 'DELETE', token: alice.token });
    expect(deleted.status).toBe(200);
    expect((await call(`/api/v1/projects/${firstProjectId}`, { token: alice.token })).status).toBe(404);
    expect(await env.MEDIA_BUCKET.head(`users/${alice.id}/sources/${firstProjectId}.mp4`)).toBeNull();
    expect(await env.MEDIA_BUCKET.head(`users/${alice.id}/projects/${firstProjectId}/transcript.json`)).toBeNull();
    expect((await call<unknown[]>('/api/v1/exports', { token: alice.token })).body.data.length).toBe(0);
  });

  it('deletes an account after password confirmation', async () => {
    expect((await call('/api/v1/account', { method: 'DELETE', token: alice.token, body: { confirm: 'DELETE', password: 'wrong-password' } })).status).toBe(401);
    expect((await call('/api/v1/account', { method: 'DELETE', token: alice.token, body: { confirm: 'DELETE', password: 'correct-horse-battery' } })).status).toBe(200);
    expect((await call('/api/v1/auth/me', { token: alice.token })).status).toBe(401);
  });
});
