import assert from 'node:assert/strict';
import test from 'node:test';
import { Repository, runMigrations } from '../db.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('database integration (requires TEST_DATABASE_URL)', { skip: !databaseUrl }, async (t) => {
  const repository = new Repository({ DATABASE_URL: databaseUrl });
  t.after(() => repository.close());

  await runMigrations(repository.pool);
  assert.deepEqual(await runMigrations(repository.pool), [], 'migrations are idempotent');

  const suffix = Date.now();
  const alice = await repository.registerUser({ email: `alice-${suffix}@example.com`, passwordHash: 'x', role: 'user' });
  const bob = await repository.registerUser({ email: `bob-${suffix}@example.com`, passwordHash: 'x', role: 'user' });
  await assert.rejects(repository.registerUser({ email: `ALICE-${suffix}@example.com`, passwordHash: 'x', role: 'user' }), /already exists/);

  await t.test('sessions can be revoked', async () => {
    await repository.createSession(alice.id, `hash-${suffix}`, new Date(Date.now() + 60_000));
    assert.equal((await repository.findActiveSession(`hash-${suffix}`))?.id, alice.id);
    await repository.revokeSession(`hash-${suffix}`);
    assert.equal(await repository.findActiveSession(`hash-${suffix}`), null);
  });

  await t.test('concurrent credit reservations never exceed the plan', async () => {
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => repository.reserveCredit(bob.id, { i })));
    const fulfilled = results.filter((result) => result.status === 'fulfilled').length;
    assert.equal(fulfilled, 3, 'FREE plan allows exactly 3 credits per month');
    assert.equal((await repository.getUsage(bob.id)).creditsRemaining, 0);
    await repository.refundCredit(bob.id, 'job-x');
    await repository.refundCredit(bob.id, 'job-x');
    assert.equal((await repository.getUsage(bob.id)).creditsRemaining, 1, 'refunds are idempotent per job');
  });

  await t.test('project lifecycle with ownership isolation', async () => {
    const { project, job } = await repository.createProject({ userId: alice.id, sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', sourceVideoId: 'dQw4w9WgXcQ', jobMetadata: { requestedClipCount: 2 } });
    assert.equal(job.state, 'QUEUED');
    assert.equal(await repository.getProject(bob.id, project.id), null);
    assert.equal(await repository.getJob(bob.id, job.id), null);

    await repository.updateProjectMetadata(project.id, { sourceUrl: project.sourceUrl, sourceId: 'dQw4w9WgXcQ', title: 'Real title', channel: 'c', durationSeconds: 120, thumbnailUrl: null, description: null, width: 1920, height: 1080, formats: [] });
    await repository.saveSourceStorage(project.id, `users/${alice.id}/sources/${project.id}.mp4`);
    await repository.updateProjectTranscript(project.id, { language: 'en', segments: [{ id: 's1', text: 'Hello', start: 0, end: 2, words: [] }] });
    assert.ok(await repository.updateJobProgress(job.id, 'TRANSCRIBING', 40, 'working'));
    await repository.saveClips(project.id, [
      { id: `clip-a-${suffix}`, start: 0, end: 30, duration: 30, score: 90, title: 'A', hook: '', reason: '', transcript: '' },
      { id: `clip-b-${suffix}`, start: 40, end: 70, duration: 30, score: 80, title: 'B', hook: '', reason: '', transcript: '' },
    ]);
    await repository.finishJob(job.id, 'COMPLETED', 'done', null, { clipCount: 2 });

    const loaded = await repository.getProject(alice.id, project.id);
    assert.equal(loaded?.name, 'Real title');
    assert.equal(loaded?.status, 'READY');
    assert.equal(loaded?.clips.length, 2);
    assert.equal(loaded?.transcript?.segments.length, 1);
    assert.equal(loaded?.latestJobId, job.id);
    assert.equal((await repository.getJobById(job.id))?.metadata.clipCount, 2);

    const edited = await repository.updateClip(alice.id, project.id, `clip-a-${suffix}`, { start: 5, end: 25, editor: { aspectRatio: '1:1' } });
    assert.equal(edited?.duration, 20);
    assert.equal(edited?.editor?.aspectRatio, '1:1');
    assert.equal(await repository.updateClip(bob.id, project.id, `clip-a-${suffix}`, { title: 'hijack' }), null);
    await assert.rejects(repository.updateClip(alice.id, project.id, `clip-a-${suffix}`, { start: 10, end: 10.5 }), /at least 1 second/);

    const render = await repository.createRenderJob({ userId: alice.id, projectId: project.id, clipId: `clip-a-${suffix}`, metadata: { resolution: '720p' } });
    assert.ok(await repository.requestCancel(render.id));
    assert.equal(await repository.updateJobProgress(render.id, 'RENDERING', 50, 'late'), false, 'workers cannot resurrect cancelled jobs');
    assert.ok(await repository.isJobCancelled(render.id));
    assert.ok(await repository.resetJobForRetry(render.id));
    assert.equal((await repository.getJobById(render.id))?.state, 'QUEUED');

    const exportId = await repository.saveExport({ userId: alice.id, projectId: project.id, clipId: `clip-a-${suffix}`, jobId: render.id, storageKey: `users/${alice.id}/projects/${project.id}/exports/x.mp4`, contentType: 'video/mp4', sizeBytes: 1234, settings: {} });
    assert.equal((await repository.listExports(alice.id))[0]?.clipTitle, 'A');
    assert.equal(await repository.getExport(bob.id, exportId), null);
    assert.equal((await repository.getExportByJob(alice.id, render.id))?.id, exportId);

    const copyId = await repository.duplicateProject(alice.id, project.id);
    assert.ok(copyId);
    const copy = await repository.getProject(alice.id, copyId!);
    assert.equal(copy?.clips.length, 2);
    assert.equal(await repository.countSourceReferences(`users/${alice.id}/sources/${project.id}.mp4`), 2);

    assert.equal(await repository.renameProject(bob.id, project.id, 'x'), false);
    assert.ok(await repository.renameProject(alice.id, project.id, 'Renamed'));
    assert.equal(await repository.deleteProject(bob.id, project.id), false);
    assert.ok(await repository.deleteProject(alice.id, project.id));
    assert.equal(await repository.getProject(alice.id, project.id), null);
    assert.equal(await repository.countSourceReferences(`users/${alice.id}/sources/${project.id}.mp4`), 1);
  });

  await t.test('admin operations', async () => {
    await repository.adminSetPlan(bob.id, 'PRO');
    assert.equal((await repository.getPlanEntitlements(bob.id)).code, 'PRO');
    await repository.createSession(bob.id, `bob-hash-${suffix}`, new Date(Date.now() + 60_000));
    await repository.adminSetSuspended(bob.id, true);
    assert.equal(await repository.findActiveSession(`bob-hash-${suffix}`), null, 'suspension revokes sessions');
    const users = await repository.adminListUsers(50, `bob-${suffix}`);
    assert.equal(users[0]?.suspended, true);
    assert.equal(typeof (await repository.adminOverview()).users, 'number');
    assert.ok(Array.isArray(await repository.adminListJobs(10)));
    await repository.deleteUser(bob.id);
    assert.equal(await repository.getUser(bob.id), null);
  });
});
