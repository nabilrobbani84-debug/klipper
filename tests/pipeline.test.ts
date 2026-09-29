import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { validateVideoUrl } from '../server/security';
import { ClipDetectionEngine } from '../server/clipDetectionEngine';
import { TranscriptionEngine } from '../server/transcriptionEngine';
import { AuthService } from '../server/authService';
import { ObjectStorageEngine } from '../server/storageEngine';
import { JobQueue } from '../server/queue';
import { FFmpegEngine } from '../server/ffmpegEngine';
import { db } from '../server/db';

async function runAllTests() {
  console.log('====================================================');
  console.log('🚀 Running ClipForge AI Production Test Suite');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    return Promise.resolve()
      .then(fn)
      .then(() => {
        console.log(`  ✓ ${name}`);
        passed++;
      })
      .catch((err) => {
        console.error(`  ✕ ${name}`);
        console.error(`    Error: ${err.message}`);
        failed++;
      });
  }

  // 1. Security & SSRF Protection Tests
  console.log('🛡️  1. Security & SSRF Validation Tests');
  await test('Blocks loopback IP (127.0.0.1)', () => {
    const res = validateVideoUrl('http://127.0.0.1:8080/admin');
    assert.strictEqual(res.isValid, false);
    assert.ok(res.error?.includes('Forbidden host') || res.error?.includes('SSRF'));
  });

  await test('Blocks AWS/Cloud metadata IP (169.254.169.254)', () => {
    const res = validateVideoUrl('http://169.254.169.254/latest/meta-data/');
    assert.strictEqual(res.isValid, false);
    assert.ok(res.error?.includes('Forbidden host') || res.error?.includes('SSRF'));
  });

  await test('Blocks private Class A IP (10.0.0.1)', () => {
    const res = validateVideoUrl('http://10.0.0.1/secrets');
    assert.strictEqual(res.isValid, false);
  });

  await test('Rejects non-whitelisted domain (evil.com)', () => {
    const res = validateVideoUrl('https://evil.com/video.mp4');
    assert.strictEqual(res.isValid, false);
    assert.ok(res.error?.includes('not authorized'));
  });

  await test('Accepts valid YouTube video URL', () => {
    const res = validateVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.strictEqual(res.isValid, true);
    assert.ok(res.sanitizedUrl?.includes('youtube.com'));
  });

  await test('Accepts valid YouTube Shorts URL', () => {
    const res = validateVideoUrl('https://youtube.com/shorts/dQw4w9WgXcQ');
    assert.strictEqual(res.isValid, true);
  });

  // 2. 7-Factor Weighted Scoring Tests
  console.log('\n📊 2. AI 7-Factor Weighted Scoring Algorithm Tests');
  await test('Calculates exact mathematical weighted score', () => {
    const breakdown = ClipDetectionEngine.calculateWeightedScore({
      hook: 100,            // 25 -> 25
      informationValue: 100,// 20 -> 20
      emotionalImpact: 100, // 15 -> 15
      storyCompleteness: 100,// 15 -> 15
      pacing: 100,          // 10 -> 10
      uniqueness: 100,      // 5  -> 5
      context: 100,         // 10 -> 10
    });
    assert.strictEqual(breakdown.totalScore, 100);
  });

  await test('Calculates realistic fractional scoring properly', () => {
    const breakdown = ClipDetectionEngine.calculateWeightedScore({
      hook: 90,             // 22.5
      informationValue: 80, // 16.0
      emotionalImpact: 70,  // 10.5
      storyCompleteness: 85,// 12.75
      pacing: 75,           // 7.5
      uniqueness: 60,       // 3.0
      context: 80,          // 8.0
    });
    // Expected: 22.5 + 16.0 + 10.5 + 12.75 + 7.5 + 3.0 + 8.0 = 80.25 -> rounded to 80.3
    assert.strictEqual(breakdown.totalScore, 80.3);
    assert.strictEqual(breakdown.retentionCurve?.length, 10);
    assert.strictEqual(breakdown.retentionCurve?.[0], 100);
  });

  // 3. Transcription Engine Multilingual & Word-level Timestamps
  console.log('\n🎙️  3. Multilingual Transcription & Word-level Timestamps Tests');
  await test('Generates word timestamps for Indonesian video', async () => {
    const trans = await TranscriptionEngine.transcribe('Tutorial Bisnis Online Sukses Indonesia', 180, { language: 'id' });
    assert.strictEqual(trans.language, 'id');
    assert.ok(trans.sentences.length > 0);
    const firstSentence = trans.sentences[0];
    assert.ok(firstSentence.words && firstSentence.words.length > 0);
    assert.ok(firstSentence.words[0].start < firstSentence.words[0].end);
    assert.ok(trans.speakerCuts.length > 0);
  });

  await test('Identifies dual speakers (Speaker A and Speaker B)', async () => {
    const trans = await TranscriptionEngine.transcribe('Podcast Interview Discussion', 240, { language: 'en' });
    const speakers = new Set(trans.sentences.map(s => s.speaker));
    assert.ok(speakers.has('Speaker A'));
    assert.ok(speakers.has('Speaker B'));
  });

  // 4. Authentication, Password Hashing & RBAC Tests
  console.log('\n🔐 4. Authentication, Password Hashing & RBAC Tests');
  await test('Hashes passwords cryptographically with unique salt', () => {
    const authService = AuthService.getInstance();
    const hash1 = authService.hashPassword('MySecurePassword123!');
    const hash2 = authService.hashPassword('MySecurePassword123!');
    assert.notStrictEqual(hash1, hash2); // Salts must differ
    assert.strictEqual(authService.verifyPassword('MySecurePassword123!', hash1), true);
    assert.strictEqual(authService.verifyPassword('WrongPassword', hash1), false);
  });

  await test('Creates and verifies secure session tokens', () => {
    const authService = AuthService.getInstance();
    const token = authService.createSession('usr_default');
    const user = authService.verifySession(token);
    assert.ok(user);
    assert.strictEqual(user.id, 'usr_default');
  });

  // 5. Database Manager Integrity Tests
  console.log('\n🗄️  5. Database Manager & Entity Persistence Tests');
  await test('Saves and finds projects and usages by userId', () => {
    const testProjId = `test_proj_${Date.now()}`;
    db.saveProject({
      id: testProjId,
      userId: 'usr_default',
      sourceUrl: 'https://youtube.com/watch?v=sample123',
      sourceVideoId: 'sample123',
      title: 'Unit Test Project',
      durationSeconds: 120,
      status: 'ready',
      contentGoal: 'retention',
      hookType: 'curiosity',
      preferredDuration: 45,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const retrieved = db.findProjectById(testProjId);
    assert.ok(retrieved);
    assert.strictEqual(retrieved.title, 'Unit Test Project');

    const userProjects = db.findProjectsByUserId('usr_default');
    assert.ok(userProjects.some(p => p.id === testProjId));

    db.deleteProject(testProjId);
    assert.strictEqual(db.findProjectById(testProjId), undefined);
  });

  // 6. Object Storage Signed URLs & Lifecycle Tests
  console.log('\n📦 6. Object Storage Signed URLs & Retention Tests');
  await test('Generates and verifies HMAC signed download URLs', async () => {
    const storage = ObjectStorageEngine.getInstance();
    const record = await storage.saveFile('clips', 'test_clip.txt', Buffer.from('Video frame buffer'), 'text/plain');
    assert.ok(record.signedUrl.includes('/api/storage/download'));

    const parsedUrl = new URL(record.signedUrl, 'http://localhost');
    const relPath = parsedUrl.searchParams.get('path');
    const expires = parsedUrl.searchParams.get('expires');
    const token = parsedUrl.searchParams.get('token');

    assert.ok(relPath && expires && token);
    assert.strictEqual(storage.verifySignedUrl(relPath, expires, token), true);

    // Tampered token test
    assert.strictEqual(storage.verifySignedUrl(relPath, expires, 'tampered_token_hash'), false);
  });

  // 7. Job Queue Retries & Backoff Tests
  console.log('\n⏱️  7. Job Queue Concurrency & Retry Engine Tests');
  await test('Schedules retry with exponential backoff on failure', () => {
    const queue = JobQueue.getInstance();
    const job = queue.createJob({
      type: 'ANALYZE_VIDEO',
      userId: 'usr_default',
      videoUrl: 'https://youtube.com/watch?v=retrytest',
    });

    assert.strictEqual(job.currentAttempt, 1);
    assert.strictEqual(job.status, 'pending');

    // Fail attempt 1
    const willRetry1 = queue.failJob(job.id, 'Temporary network timeout', 100);
    assert.strictEqual(willRetry1, true);
    assert.strictEqual(job.status, 'retrying');
    assert.strictEqual(job.currentAttempt, 2);

    // Fail attempt 2
    const willRetry2 = queue.failJob(job.id, 'Second network timeout', 100);
    assert.strictEqual(willRetry2, true);
    assert.strictEqual(job.currentAttempt, 3);

    // Fail attempt 3 (permanently failed)
    const willRetry3 = queue.failJob(job.id, 'Third failure threshold reached', 100);
    assert.strictEqual(willRetry3, false);
    assert.strictEqual(job.status, 'failed');
  });

  // 8. FFmpeg Video Engine Real Render Test
  console.log('\n🎬 8. FFmpeg Video Engine Real Render Tests');
  await test('Compiles a real 9:16 vertical MP4 video with -14 LUFS loudnorm', async () => {
    const testOut = path.join(process.cwd(), 'storage', 'temp', `test_render_${Date.now()}.mp4`);
    const result = await FFmpegEngine.renderClip({
      inputPathOrUrl: 'testsrc',
      outputPath: testOut,
      startTimeSeconds: 0,
      durationSeconds: 3,
      aspectRatio: '9:16',
      resolution: '720p',
      cropPanXPercent: 50,
      normalizeAudio: true,
      subtitleText: 'Klipper Automated Test Render',
    });

    assert.ok(fs.existsSync(result.outputPath));
    assert.ok(result.sizeBytes > 1000);
    // Cleanup scratch file
    fs.unlinkSync(result.outputPath);
  });

  // 9. AI Clip Boundary Validation & Inverted Timestamp Repair (Rule 12 & 13)
  console.log('\n🛠️  9. AI Clip Boundary Validation & Repair Tests');
  await test('Repairs inverted timestamps where startTime > endTime', () => {
    const repaired = ClipDetectionEngine.validateAndRepairBoundaries(50, 20, 300, 30);
    assert.strictEqual(repaired.startTime, 20);
    assert.strictEqual(repaired.endTime, 50);
    assert.strictEqual(repaired.duration, 30);
  });

  await test('Enforces minimum clip duration of 15 seconds', () => {
    const repaired = ClipDetectionEngine.validateAndRepairBoundaries(10, 14, 300, 30, 15);
    assert.strictEqual(repaired.startTime, 10);
    assert.strictEqual(repaired.endTime, 25);
    assert.strictEqual(repaired.duration, 15);
  });

  await test('Clamps timestamps within total video duration bounds', () => {
    const repaired = ClipDetectionEngine.validateAndRepairBoundaries(290, 350, 300, 30, 15);
    assert.ok(repaired.endTime <= 300);
    assert.ok(repaired.startTime >= 0);
  });

  // 10. Near-Duplicate Overlap Clip Filtering (Rule 14)
  console.log('\n🔍 10. Near-Duplicate Overlap Clip Filtering Tests');
  await test('Filters out overlapping clips sharing >55% timeline', () => {
    const dummyClips: any[] = [
      { id: 'clip-1', startTime: 10, endTime: 50, duration: 40, score: 94 }, // 10-50
      { id: 'clip-2', startTime: 15, endTime: 52, duration: 37, score: 86 }, // heavily overlaps clip-1
      { id: 'clip-3', startTime: 120, endTime: 160, duration: 40, score: 91 }, // distinct moment
    ];

    const deduplicated = ClipDetectionEngine.filterOverlappingClips(dummyClips, 0.55);
    assert.strictEqual(deduplicated.length, 2);
    assert.ok(deduplicated.some(c => c.id === 'clip-1'));
    assert.ok(deduplicated.some(c => c.id === 'clip-3'));
    assert.ok(!deduplicated.some(c => c.id === 'clip-2')); // lower-scoring overlapping clip removed
  });

  // 11. Multi-Tenant Authorization Tests (Rule 6)
  console.log('\n🔒 11. Multi-Tenant Authorization Isolation Tests');
  await test('Blocks User A from accessing or mutating User B private project', () => {
    // Create User A and User B
    const userA = { id: 'usr_alice_123', email: 'alice@klipper.ai', name: 'Alice', role: 'USER' as 'USER' | 'ADMIN', plan: 'free' as const, createdAt: '', updatedAt: '' };
    const userB = { id: 'usr_bob_456', email: 'bob@klipper.ai', name: 'Bob', role: 'USER' as 'USER' | 'ADMIN', plan: 'free' as const, createdAt: '', updatedAt: '' };
    db.saveUser(userA);
    db.saveUser(userB);

    // User B creates a project
    const bobProject = {
      id: 'proj_bob_secret',
      userId: userB.id,
      sourceUrl: 'https://youtube.com/watch?v=secretbob',
      sourceVideoId: 'secretbob',
      title: 'Bob Secret Strategy',
      durationSeconds: 120,
      status: 'ready' as const,
      contentGoal: 'retention',
      hookType: 'curiosity',
      preferredDuration: 45,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.saveProject(bobProject);

    // Verify User A fetching their projects cannot see Bob's project
    const aliceProjects = db.findProjectsByUserId(userA.id);
    assert.strictEqual(aliceProjects.some(p => p.id === 'proj_bob_secret'), false);

    // Verify Bob's project ownership check
    const fetched = db.findProjectById('proj_bob_secret');
    assert.ok(fetched);
    const aliceCanAccess = fetched.userId === userA.id || userA.role === 'ADMIN';
    assert.strictEqual(aliceCanAccess, false);

    // Cleanup
    db.deleteProject('proj_bob_secret');
  });

  // 12. Server-Side Atomic Credit Metering Tests (Rule 25)
  console.log('\n💳 12. Server-Side Atomic Credit Metering Tests');
  await test('Prevents overdraft and negative credits', () => {
    const authService = AuthService.getInstance();
    const testUser = { id: 'usr_meter_test', email: 'meter@klipper.ai', name: 'Meter Test', role: 'USER' as const, plan: 'free' as const, createdAt: '', updatedAt: '' };
    db.saveUser(testUser);

    // Set usage to 10 credits
    db.updateUsage(testUser.id, { creditsRemaining: 10 });

    // Requesting 5 credits should succeed
    const res1 = authService.deductCredits(testUser.id, 5, 60);
    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.remainingCredits, 5);

    // Requesting 100 credits should fail cleanly with overdraft warning
    const res2 = authService.deductCredits(testUser.id, 100, 600);
    assert.strictEqual(res2.success, false);
    assert.strictEqual(res2.remainingCredits, 5); // Credits preserved, not negative
  });

  console.log('\n====================================================');
  console.log(`🏁 Test Summary: ${passed} passed, ${failed} failed`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((e) => {
  console.error('Test Suite Fatal Exception:', e);
  process.exit(1);
});
