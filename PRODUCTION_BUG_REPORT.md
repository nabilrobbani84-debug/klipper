# Klipper AI — Production Bug Audit Report

**Audit Target Repository**: https://github.com/nabilrobbani84-debug/klipper  
**Project Name**: Klipper — AI YouTube Video Clipper  
**Auditor**: Principal Software Engineer, Security Engineer, QA & DevOps Engineer  
**Date**: September 29, 2026  

---

### Summary of Identified Bugs & Vulnerabilities

| Bug ID | Severity | Component / File | Problem Summary | Status |
|---|---|---|---|---|
| **BUG-001** | **CRITICAL** | `server.ts:180` | Broken Object-Level Authorization (IDOR) on Project Retrieval | **FIXED** |
| **BUG-002** | **HIGH** | `server.ts:247` | Multi-Tenant Data Leak in Global Job Queue Listing | **FIXED** |
| **BUG-003** | **HIGH** | `server/authService.ts:128` | Double-Subtraction Race / Mutation in Credit Deduction | **FIXED** |
| **BUG-004** | **HIGH** | `server/clipDetectionEngine.ts:210` | Unchecked AI Inverted/Out-of-Bounds Timestamps | **FIXED** |
| **BUG-005** | **MEDIUM** | `server/clipDetectionEngine.ts:270` | Unfiltered Overlapping Near-Duplicate Clips | **FIXED** |
| **BUG-006** | **HIGH** | `src/services/aiClipService.ts:154` | Client-Side Property Stripping of Scoring & Smart Reframe | **FIXED** |
| **BUG-007** | **MEDIUM** | `server/storageEngine.ts:98` | Buffer Length Exception in Signed URL HMAC Verification | **FIXED** |
| **BUG-008** | **MEDIUM** | `ExportModal.tsx:119` & `App.tsx:208` | Runtime iFrame UI Freezing via `window.alert()` | **FIXED** |
| **BUG-009** | **LOW** | `server/errors.ts:31` | Missing `requestId` and `success: false` Envelope in Error Responses | **FIXED** |
| **BUG-010** | **LOW** | `VideoStudio.tsx:118` | Unhandled HTML5 Video Playback Promise Rejection | **FIXED** |

---

### Detailed Bug Analyses

#### BUG-001
- **Severity**: **CRITICAL** (Security / Authorization)
- **File**: `server.ts`
- **Line**: 180–187
- **Problem**: `GET /api/projects/:id` fetched and returned any project from the database using only the project ID passed in route parameters without verifying whether the requesting user owned the project or possessed `ADMIN` privileges.
- **Root Cause**: The authorization check `if (project.userId !== user.id && user.role !== 'ADMIN')` was omitted on the GET route, whereas it was present on DELETE.
- **Impact**: Any authenticated user could read private video metadata, source URLs, and AI-generated clips of other creators by guessing or enumerating project IDs.
- **Fix**: Implemented strict tenant authorization verification:
  ```typescript
  if (project.userId !== user.id && user.role !== 'ADMIN') {
    return res.status(403).json(formatErrorResponse(new AppError('FORBIDDEN', 'Access denied to this project', 403), (req as any).id));
  }
  ```
- **Test**: Automated test in `tests/pipeline.test.ts` (Test Suite 11: Multi-Tenant Authorization Isolation Tests). User A cannot access User B's project (`assert.strictEqual(aliceCanAccess, false)`).

---

#### BUG-002
- **Severity**: **HIGH** (Security / Privacy)
- **File**: `server.ts`
- **Line**: 247–265
- **Problem**: `GET /api/jobs` and `GET /api/jobs/:id` returned jobs belonging to all users across the entire system.
- **Root Cause**: The queue endpoint did not filter job records by `req.user.id`.
- **Impact**: Privacy leakage where any user could view the processing status, filenames, and YouTube source links of all other concurrent users.
- **Fix**: Filtered queue results by `job.userId === user.id` unless the requester has role `ADMIN`.
- **Test**: Verified via multi-tenant queue isolation test and endpoint simulation.

---

#### BUG-003
- **Severity**: **HIGH** (Business Logic / Data Integrity)
- **File**: `server/authService.ts`
- **Line**: 128–136
- **Problem**: Calling `auth.deductCredits(userId, credits)` resulted in double-deduction calculation on the return object (e.g. deducting 5 from 10 returned 0 remaining credits instead of 5).
- **Root Cause**: `db.updateUsage` mutated `usage.creditsRemaining` in-place using `Object.assign`. Subsequently, the return statement performed `usage.creditsRemaining - credits` a second time on the already mutated value.
- **Impact**: Creators were falsely informed that their credit balance had reached zero prematurely.
- **Fix**: Calculated `const newRemaining = usage.creditsRemaining - credits;` once and reused it consistently in both database update and return statement.
- **Test**: Automated test in `tests/pipeline.test.ts` (Test Suite 12: Server-Side Atomic Credit Metering Tests). Deducting 5 from 10 leaves exactly 5 (`assert.strictEqual(res1.remainingCredits, 5)`).

---

#### BUG-004
- **Severity**: **HIGH** (AI Pipeline / Video Processing)
- **File**: `server/clipDetectionEngine.ts`
- **Line**: 210–225
- **Problem**: AI-generated clip timestamps could produce inverted timestamps (`startTime > endTime`), negative durations, or start/end points extending beyond `videoDuration`.
- **Root Cause**: The raw JSON output from the LLM was parsed directly into candidate clip models without numeric boundary validation or sanitization.
- **Impact**: FFmpeg worker rendering failed when handed invalid `-ss` and `-t` boundaries, causing render jobs to stall or fail.
- **Fix**: Implemented `ClipDetectionEngine.validateAndRepairBoundaries(start, end, videoDuration, preferredDuration, minDuration=15, maxDuration=60)`. Inverted timestamps are automatically flipped, clamped within `[0, videoDuration]`, and minimum 15-second context windows are enforced.
- **Test**: Automated test in `tests/pipeline.test.ts` (Test Suite 9: AI Clip Boundary Validation & Repair Tests). Verified inversion flip (50, 20 -> 20, 50) and 15s minimum clamp.

---

#### BUG-005
- **Severity**: **MEDIUM** (AI Quality / UX)
- **File**: `server/clipDetectionEngine.ts`
- **Line**: 70–120
- **Problem**: AI candidate generation could generate multiple clips that overlapped by >70% of the same timeframe (e.g. 00:10–00:50 and 00:15–00:52).
- **Root Cause**: Absence of non-maximum suppression / overlap deduplication filtering.
- **Impact**: Redundant clips cluttering user results and wasting user export credits.
- **Fix**: Implemented `ClipDetectionEngine.filterOverlappingClips(clips, maxOverlapRatio=0.55)`. Calculates intersection-over-union; if overlap exceeds 55%, keeps the clip with the superior 7-factor viral score.
- **Test**: Automated test in `tests/pipeline.test.ts` (Test Suite 10: Near-Duplicate Overlap Clip Filtering Tests). Overlapping clips are filtered to distinct timeline moments.

---

#### BUG-006
- **Severity**: **HIGH** (Frontend / State)
- **File**: `src/services/aiClipService.ts`
- **Line**: 154–188
- **Problem**: When `/api/analyze-clips` returned full clip candidates, the client mapping function discarded `scoringBreakdown` (7 factors), `smartReframe` (speaker tracking cuts), and `language`.
- **Root Cause**: The client-side adapter manually reconstructed clip properties and omitted newly introduced backend fields.
- **Impact**: Frontend was unable to display the 7-factor scoring accordion or active speaker timeline switching.
- **Fix**: Restructured mapper to spread `...item`, retaining `scoringBreakdown`, `smartReframe`, and word-level sentence tokens.
- **Test**: Verified by inspecting response pass-through into `activeProject.clips[0]`.

---

#### BUG-007
- **Severity**: **MEDIUM** (Storage Security)
- **File**: `server/storageEngine.ts`
- **Line**: 98–105
- **Problem**: `crypto.timingSafeEqual` threw an unhandled exception `Input buffers must have the same byte length` if an incoming download URL had an invalid or truncated token.
- **Root Cause**: `timingSafeEqual` strictly requires matching buffer byte lengths.
- **Impact**: HTTP 500 internal server error instead of a clean HTTP 403 unauthorized response when invalid signatures were presented.
- **Fix**: Added length validation: `if (token.length !== expected.length) return false;` before executing `crypto.timingSafeEqual`.
- **Test**: Automated test in `tests/pipeline.test.ts` (Test Suite 6: Object Storage Signed URLs & Retention Tests).

---

#### BUG-008
- **Severity**: **MEDIUM** (Runtime Environment / UX)
- **File**: `src/components/ExportModal.tsx` & `src/App.tsx`
- **Line**: 119, 162 in `ExportModal.tsx`; 208 in `App.tsx`
- **Problem**: Usage of `window.alert(...)` for error notifications caused runtime freezing or browser blocking inside iframe containers.
- **Root Cause**: Reliance on legacy browser alert dialogs instead of in-app UI banners.
- **Impact**: Poor UX, modal lockout, and violation of the runtime environment constraints.
- **Fix**: Replaced all `alert()` instances with an in-modal dismissible error banner in `ExportModal.tsx` and a floating toast notification in `src/App.tsx`.
- **Test**: Zero occurrences of `alert(` in codebase confirmed via static search.

---

#### BUG-009
- **Severity**: **LOW** (API Architecture)
- **File**: `server/errors.ts`
- **Line**: 31–50
- **Problem**: Error responses did not conform to the enterprise standard format requiring `success: false` and `requestId`.
- **Root Cause**: Initial error formatter only returned `{ error: { code, message } }`.
- **Impact**: Inconsistent API contract and difficulty correlating frontend errors with server logs.
- **Fix**: Updated `formatErrorResponse` to return `{ success: false, error: { code, message, requestId } }`.
- **Test**: Confirmed by checking API error responses across tests.

---

#### BUG-010
- **Severity**: **LOW** (Browser Runtime)
- **File**: `src/components/VideoStudio.tsx`
- **Line**: 118–125
- **Problem**: Calling `videoRef.current.play()` without handling the returned Promise resulted in uncaught `NotAllowedError` exceptions if the browser paused playback due to autoplay policy.
- **Root Cause**: Unhandled asynchronous Promise returned by HTMLMediaElement.play().
- **Impact**: Console warning/error when rapid play/pause interactions occurred.
- **Fix**: Wrapped play invocation in `.then(() => setIsPlaying(true)).catch(err => setIsPlaying(false))`.
- **Test**: Verified interactive timeline play/pause state transitions without console errors.
