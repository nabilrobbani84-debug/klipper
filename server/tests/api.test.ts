import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { createApp } from '../api.js';
import { createMediaToken, createSessionToken, hashSessionToken } from '../auth.js';
import type { Repository } from '../db.js';
import { AppError } from '../errors.js';
import { createLogger } from '../logger.js';
import { Metrics } from '../metrics.js';
import { getPlanEntitlements } from '../plans.js';
import type { ProcessingQueue } from '../queue.js';
import { LocalObjectStorage } from '../services/storage.js';
import type { AuthenticatedUser, JobRecord, ProjectRecord } from '../types.js';
import { testConfig } from './helpers.js';

const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clipforge-api-'));
const config = testConfig({ STORAGE_DIR: storageRoot });
const sessions = new Map<string, AuthenticatedUser>();
const calls: string[] = [];
let creditsLeft = 1;

function token(user: AuthenticatedUser) {
  const { token: value } = createSessionToken(user, config.AUTH_SECRET, 3600);
  sessions.set(hashSessionToken(value), user);
  return value;
}

const project: ProjectRecord = {
  id: 'p1', userId: 'alice', name: 'Alice project', sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', sourceVideoId: 'dQw4w9WgXcQ',
  status: 'READY', metadata: null, transcript: null, latestJobId: 'j1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  clips: [{ id: 'c1', start: 0, end: 30, duration: 30, score: 80, title: 'Clip', hook: '', reason: '', transcript: '' }],
};
const job: JobRecord = { id: 'j1', userId: 'alice', projectId: 'p1', kind: 'analysis', state: 'TRANSCRIBING', progress: 40, message: '', errorCode: null, metadata: {}, createdAt: '', updatedAt: '' };

const repository = {
  findActiveSession: async (hash: string) => sessions.get(hash) ?? null,
  health: async () => undefined,
  ensureDevUser: async () => undefined,
  audit: async () => undefined,
  getUser: async (id: string) => ({ id, email: `${id}@example.com`, passwordHash: '', role: 'user', plan: 'FREE', suspended: false, createdAt: '' }),
  getUsage: async () => ({ plan: getPlanEntitlements('FREE'), creditsUsed: 0, creditsRemaining: 3, storageBytes: 0, activeJobs: 0 }),
  getPlanEntitlements: async () => getPlanEntitlements('FREE'),
  reserveCredit: async () => {
    if (creditsLeft <= 0) throw new AppError('CREDIT_LIMIT_REACHED', 'Credits used up.', 402);
    creditsLeft -= 1;
    return getPlanEntitlements('FREE');
  },
  createProject: async () => ({ project: { ...project, id: 'p-new', status: 'PROCESSING' }, job: { ...job, id: 'j-new', projectId: 'p-new', state: 'QUEUED' } }),
  getProject: async (userId: string, projectId: string) => (userId === project.userId && projectId === project.id ? project : null),
  getSourceStorageKey: async () => 'users/alice/sources/p1.mp4',
  listProjects: async (userId: string) => (userId === project.userId ? [project] : []),
  getJob: async (userId: string, jobId: string) => (userId === job.userId && jobId === job.id ? job : null),
  requestCancel: async (jobId: string) => { calls.push(`cancel:${jobId}`); return true; },
  refundCredit: async (_userId: string, jobId: string) => { calls.push(`refund:${jobId}`); },
  setProjectStatus: async () => undefined,
  finishJob: async () => undefined,
} as unknown as Repository;

const queue = {
  add: async (name: string) => { calls.push(`enqueue:${name}`); return {} as never; },
  getJob: async () => undefined,
  waitUntilReady: async () => ({}) as never,
  close: async () => undefined,
  getJobCounts: async () => ({}),
  getWorkersCount: async () => 1,
} as unknown as ProcessingQueue;

let baseUrl = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;

before(async () => {
  const app = createApp({ config, repository, queue, storage: new LocalObjectStorage(config), metrics: new Metrics(), logger: createLogger(config) });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const mediaPath = path.join(storageRoot, 'users/alice/sources');
  await fs.mkdir(mediaPath, { recursive: true });
  await fs.writeFile(path.join(mediaPath, 'p1.mp4'), Buffer.from('0123456789'));
});

after(async () => {
  server.close();
  await fs.rm(storageRoot, { recursive: true, force: true });
});

const request = (pathname: string, init: RequestInit & { auth?: string } = {}) => fetch(`${baseUrl}${pathname}`, {
  ...init,
  headers: { 'Content-Type': 'application/json', ...(init.auth ? { Authorization: `Bearer ${init.auth}` } : {}), ...(init.headers ?? {}) },
});

test('health endpoints and security headers', async () => {
  const response = await request('/health');
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('content-security-policy')?.includes("default-src 'self'"));
  assert.ok(response.headers.get('x-request-id'));
  assert.equal((await request('/ready')).status, 200);
});

test('rejects unauthenticated access', async () => {
  const response = await request('/api/v1/projects');
  assert.equal(response.status, 401);
  const body = await response.json() as { success: boolean; error: { code: string } };
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'UNAUTHENTICATED');
});

test('rejects forged or unknown sessions', async () => {
  const { token: unknown } = createSessionToken({ id: 'mallory' }, config.AUTH_SECRET, 3600);
  assert.equal((await request('/api/v1/projects', { auth: unknown })).status, 401);
  assert.equal((await request('/api/v1/projects', { auth: 'abc.def' })).status, 401);
});

test('validates YouTube URLs and rights confirmation server-side', async () => {
  const auth = token({ id: 'alice', role: 'user' });
  const invalid = await request('/api/v1/projects', { method: 'POST', auth, body: JSON.stringify({ youtubeUrl: 'https://evil.example/watch?v=dQw4w9WgXcQ', rightsConfirmed: true }) });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json() as { error: { code: string } }).error.code, 'INVALID_YOUTUBE_URL');
  const noRights = await request('/api/v1/projects', { method: 'POST', auth, body: JSON.stringify({ youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' }) });
  assert.equal(noRights.status, 400);
});

test('creates an async job (202) then enforces credit limits (402)', async () => {
  const auth = token({ id: 'alice', role: 'user' });
  const body = JSON.stringify({ youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ', rightsConfirmed: true, requestedClipCount: 3 });
  const created = await request('/api/v1/projects', { method: 'POST', auth, body });
  assert.equal(created.status, 202);
  const payload = await created.json() as { data: { jobId: string; projectId: string } };
  assert.equal(payload.data.jobId, 'j-new');
  assert.ok(calls.includes('enqueue:analysis'));
  const limited = await request('/api/v1/projects', { method: 'POST', auth, body });
  assert.equal(limited.status, 402);
  const tooMany = await request('/api/v1/projects', { method: 'POST', auth, body: JSON.stringify({ youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ', rightsConfirmed: true, requestedClipCount: 10 }) });
  assert.equal(tooMany.status, 402);
});

test('users cannot access other users projects or jobs', async () => {
  const bob = token({ id: 'bob', role: 'user' });
  assert.equal((await request('/api/v1/projects/p1', { auth: bob })).status, 404);
  assert.equal((await request('/api/v1/jobs/j1', { auth: bob })).status, 404);
  assert.equal((await request('/api/v1/jobs/j1/cancel', { method: 'POST', auth: bob })).status, 404);
  const alice = token({ id: 'alice', role: 'user' });
  const own = await request('/api/v1/projects/p1', { auth: alice });
  assert.equal(own.status, 200);
  const data = (await own.json() as { data: { sourceMediaUrl: string } }).data;
  assert.match(data.sourceMediaUrl, /^http:\/\/localhost:8080\/media\//);
});

test('cancelling an analysis job refunds the credit', async () => {
  const alice = token({ id: 'alice', role: 'user' });
  const response = await request('/api/v1/jobs/j1/cancel', { method: 'POST', auth: alice });
  assert.equal(response.status, 200);
  assert.ok(calls.includes('cancel:j1') && calls.includes('refund:j1'));
});

test('admin routes require the admin role', async () => {
  assert.equal((await request('/api/v1/admin/overview', { auth: token({ id: 'alice', role: 'user' }) })).status, 403);
});

test('signed media URLs support range requests and reject tampering', async () => {
  const valid = createMediaToken({ key: 'users/alice/sources/p1.mp4', userId: 'alice' }, config.AUTH_SECRET, 60);
  const full = await fetch(`${baseUrl}/media/${valid}`);
  assert.equal(full.status, 200);
  assert.equal(await full.text(), '0123456789');
  const partial = await fetch(`${baseUrl}/media/${valid}`, { headers: { Range: 'bytes=2-4' } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), 'bytes 2-4/10');
  assert.equal(await partial.text(), '234');
  assert.equal((await fetch(`${baseUrl}/media/${valid}x`)).status, 403);
  const foreign = createMediaToken({ key: 'users/bob/sources/p1.mp4', userId: 'alice' }, config.AUTH_SECRET, 60);
  assert.equal((await fetch(`${baseUrl}/media/${foreign}`)).status, 403);
});

test('unknown API routes return JSON 404', async () => {
  const response = await request('/api/v1/nope', { auth: token({ id: 'alice' }) });
  assert.equal(response.status, 404);
});
