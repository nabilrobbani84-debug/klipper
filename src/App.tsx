import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navbar } from './components/Navbar';
import { LandingPage } from './components/LandingPage';
import { ProcessingModal } from './components/ProcessingModal';
import { ClipCandidateList } from './components/ClipCandidateList';
import { ClipSettingsModal } from './components/ClipSettingsModal';
import { VideoStudio } from './components/VideoStudio';
import { SocialPackModal } from './components/SocialPackModal';
import { ExportModal } from './components/ExportModal';
import { DownloadCenter } from './components/DownloadCenter';
import { ProjectsDashboard } from './components/ProjectsDashboard';
import { QueueDashboard } from './components/QueueDashboard';
import { TemplatesGallery } from './components/TemplatesGallery';
import { SubscriptionModal } from './components/SubscriptionModal';
import { AdminDashboard } from './components/AdminDashboard';
import { AuthModal } from './components/AuthModal';
import { LegalNoticeModal } from './components/LegalNoticeModal';
import { Loader2 } from 'lucide-react';

import {
  AspectRatio,
  ClipCandidate,
  ContentGoal,
  EditingPreset,
  CaptionPreset,
  HookType,
  Project,
  UserAccount,
} from './types';

import {
  ApiError,
  cancelBackendJob,
  clipToEditorPatch,
  createAnalysisJob,
  deleteBackendProject,
  duplicateBackendProject,
  fetchCurrentUser,
  fetchPublicConfig,
  fetchUsage,
  getBackendProject,
  getSessionToken,
  listBackendProjects,
  logout as apiLogout,
  mapBackendProject,
  mapSessionToAccount,
  patchClip,
  renameBackendProject,
  watchBackendJob,
} from './services/apiClient';

type Tab = 'landing' | 'clips' | 'studio' | 'projects' | 'templates' | 'exports' | 'queue' | 'admin';
const STAGE_INDEX: Record<string, number> = {
  QUEUED: 0, DOWNLOADING: 1, EXTRACTING_AUDIO: 2, TRANSCRIBING: 3, ANALYZING: 4,
  GENERATING_CLIPS: 5, REFRAMING: 6, GENERATING_CAPTIONS: 7, RENDERING: 8, UPLOADING: 8, COMPLETED: 8,
};

export default function App() {
  const [currentTab, setCurrentTab] = useState<Tab>('landing');
  const [bootstrapping, setBootstrapping] = useState(true);
  const [user, setUser] = useState<UserAccount | null>(null);
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [authModal, setAuthModal] = useState<null | 'login' | 'register'>(null);
  const authResume = useRef<(() => void) | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;
  const [activeClipId, setActiveClipId] = useState<string>('');
  const activeClip = activeProject?.clips.find((c) => c.id === activeClipId) ?? activeProject?.clips[0] ?? null;

  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProject, setProcessingProject] = useState<Project | null>(null);
  const [processingStepIndex, setProcessingStepIndex] = useState(0);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingLog, setProcessingLog] = useState('');
  const [processingJobId, setProcessingJobId] = useState<string | null>(null);
  const processingAbort = useRef<AbortController | null>(null);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [contentGoal, setContentGoal] = useState<ContentGoal>('retention');
  const [hookType, setHookType] = useState<HookType>('curiosity');
  const [preferredDuration, setPreferredDuration] = useState(45);
  const [requestedClipCount, setRequestedClipCount] = useState(3);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [editingPreset, setEditingPreset] = useState<EditingPreset>('dynamic-mrbeast');

  const [isSubscriptionOpen, setIsSubscriptionOpen] = useState(false);
  const [isLegalOpen, setIsLegalOpen] = useState(false);
  const [socialModalClip, setSocialModalClip] = useState<ClipCandidate | null>(null);
  const [exportModalClip, setExportModalClip] = useState<ClipCandidate | null>(null);
  const [toast, setToast] = useState<{ kind: 'error' | 'success'; message: string } | null>(null);

  const notify = useCallback((kind: 'error' | 'success', message: string) => {
    setToast({ kind, message });
    window.setTimeout(() => setToast(null), 5000);
  }, []);

  const refreshUsage = useCallback(async () => {
    try {
      const usage = await fetchUsage();
      setUser((prev) => (prev ? { ...prev, credits: usage.creditsRemaining, minutesUsed: usage.creditsUsed, minutesLimit: usage.plan.monthlyCredits, storageMbUsed: Math.round(usage.storageBytes / 1_000_000), storageMbLimit: Math.round(usage.plan.storageLimitBytes / 1_000_000) } : prev));
    } catch { /* non-fatal */ }
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const backend = await listBackendProjects();
      setProjects(backend.map(mapBackendProject));
    } catch (error) {
      if (error instanceof ApiError && error.status !== 401) notify('error', error.message);
    }
  }, [notify]);

  // Bootstrap: restore session (token or dev auth), load config + projects.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await fetchPublicConfig().catch(() => null);
        if (!cancelled && config) setRegistrationOpen(config.registrationOpen);
        const hasDevAuth = Boolean(import.meta.env.DEV && import.meta.env.VITE_DEV_USER_ID);
        if (getSessionToken() || hasDevAuth) {
          const me = await fetchCurrentUser();
          if (cancelled) return;
          setUser(mapSessionToAccount(me));
          await loadProjects();
        }
      } catch {
        /* not signed in */
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadProjects]);

  const requireAuth = useCallback((action: () => void) => {
    if (user) { action(); return; }
    authResume.current = action;
    setAuthModal('login');
  }, [user]);

  const handleAuthenticated = useCallback(async () => {
    try {
      const me = await fetchCurrentUser();
      setUser(mapSessionToAccount(me));
      await loadProjects();
      const resume = authResume.current;
      authResume.current = null;
      resume?.();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Could not load your account.');
    }
  }, [loadProjects, notify]);

  const handleLogout = useCallback(async () => {
    await apiLogout().catch(() => undefined);
    setUser(null);
    setProjects([]);
    setActiveProjectId(null);
    setCurrentTab('landing');
    notify('success', 'Signed out.');
  }, [notify]);

  const startAnalysis = useCallback(async (url: string) => {
    const abort = new AbortController();
    processingAbort.current = abort;
    setIsProcessing(true);
    setProcessingProject(null);
    setProcessingStepIndex(0);
    setProcessingProgress(3);
    setProcessingLog('Validating URL and queuing the job…');
    setProcessingJobId(null);
    try {
      const queued = await createAnalysisJob({ youtubeUrl: url, contentGoal, hookType, preferredDuration, aspectRatio, requestedClipCount });
      setProcessingJobId(queued.jobId);
      setProcessingLog('Job queued. Processing continues even if you close this tab.');
      const finished = await watchBackendJob(queued.jobId, (job) => {
        setProcessingStepIndex(STAGE_INDEX[job.state] ?? 0);
        setProcessingProgress(job.progress);
        setProcessingLog(job.message);
      }, abort.signal);
      if (finished.state === 'CANCELLED') { notify('error', 'Processing cancelled.'); return; }
      if (finished.state !== 'COMPLETED') throw new Error(finished.message || 'Video processing failed.');
      const project = mapBackendProject(await getBackendProject(queued.projectId));
      if (project.clips.length === 0) throw new Error('No clip candidates were produced for this video.');
      setProjects((prev) => [project, ...prev.filter((p) => p.id !== project.id)]);
      setActiveProjectId(project.id);
      setActiveClipId(project.clips[0].id);
      setProcessingProject(project);
      void refreshUsage();
      setCurrentTab('clips');
      notify('success', `${project.clips.length} clips are ready.`);
    } catch (error) {
      if (abort.signal.aborted) return;
      notify('error', error instanceof Error ? error.message : 'Analysis failed.');
    } finally {
      if (processingAbort.current === abort) processingAbort.current = null;
      setIsProcessing(false);
      setProcessingJobId(null);
    }
  }, [aspectRatio, contentGoal, hookType, notify, preferredDuration, refreshUsage, requestedClipCount]);

  const handleStartAnalysis = useCallback((url: string) => requireAuth(() => void startAnalysis(url)), [requireAuth, startAnalysis]);

  const handleCancelProcessing = useCallback(async () => {
    const jobId = processingJobId;
    processingAbort.current?.abort();
    setIsProcessing(false);
    if (jobId) await cancelBackendJob(jobId).catch(() => undefined);
  }, [processingJobId]);

  // Persist clip edits to the backend (debounced per clip) so renders use the saved settings.
  const saveTimers = useRef<Record<string, number>>({});
  const handleUpdateClip = useCallback((updated: ClipCandidate) => {
    if (!activeProjectId) return;
    setProjects((prev) => prev.map((p) => (p.id === activeProjectId ? { ...p, lastEdited: 'Just now', clips: p.clips.map((c) => (c.id === updated.id ? updated : c)) } : p)));
    window.clearTimeout(saveTimers.current[updated.id]);
    saveTimers.current[updated.id] = window.setTimeout(() => {
      patchClip(activeProjectId, updated.id, { title: updated.title, editor: clipToEditorPatch(updated) }).catch((error) => notify('error', error instanceof Error ? error.message : 'Could not save edits.'));
    }, 700);
  }, [activeProjectId, notify]);

  const handleTrimClip = useCallback((clip: ClipCandidate, start: number, end: number) => {
    if (!activeProjectId) return;
    patchClip(activeProjectId, clip.id, { start, end })
      .then((updated) => {
        setProjects((prev) => prev.map((p) => (p.id === activeProjectId ? { ...p, clips: p.clips.map((c) => (c.id === clip.id ? { ...c, startTime: updated.start, endTime: updated.end, duration: updated.duration } : c)) } : p)));
        notify('success', 'Clip range updated.');
      })
      .catch((error) => notify('error', error instanceof Error ? error.message : 'Could not update clip.'));
  }, [activeProjectId, notify]);

  const handleDuplicateProject = useCallback(async (project: Project) => {
    try {
      const copy = mapBackendProject(await duplicateBackendProject(project.id));
      setProjects((prev) => [copy, ...prev]);
      notify('success', 'Project duplicated.');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Could not duplicate project.');
    }
  }, [notify]);

  const handleDeleteProject = useCallback(async (projectId: string) => {
    try {
      await deleteBackendProject(projectId);
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      if (activeProjectId === projectId) { setActiveProjectId(null); setCurrentTab('projects'); }
      void refreshUsage();
      notify('success', 'Project deleted.');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Could not delete project.');
    }
  }, [activeProjectId, notify, refreshUsage]);

  const handleRenameProject = useCallback(async (projectId: string, newName: string) => {
    setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, name: newName } : p)));
    try {
      await renameBackendProject(projectId, newName);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Could not rename project.');
      void loadProjects();
    }
  }, [loadProjects, notify]);

  const handleApplyTemplate = useCallback((preset: EditingPreset, captionPreset: CaptionPreset, color: string) => {
    if (!activeClip) { notify('error', 'Open a clip in the studio first.'); return; }
    handleUpdateClip({ ...activeClip, editingPreset: preset, captions: { ...activeClip.captions, preset: captionPreset, highlightColor: color } });
    setCurrentTab('studio');
  }, [activeClip, handleUpdateClip, notify]);

  const openProjectById = useCallback(async (projectId: string) => {
    try {
      const project = mapBackendProject(await getBackendProject(projectId));
      setProjects((prev) => [project, ...prev.filter((p) => p.id !== project.id)]);
      setActiveProjectId(project.id);
      if (project.clips[0]) setActiveClipId(project.clips[0].id);
      setCurrentTab('clips');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Could not open project.');
    }
  }, [notify]);

  const hasActiveProject = Boolean(activeProject && activeProject.clips.length > 0);

  if (bootstrapping) {
    return (
      <div className="min-h-screen bg-[#08090E] text-slate-100 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#08090E] text-slate-100 flex flex-col font-sans">
      <Navbar
        currentTab={currentTab}
        setCurrentTab={(tab) => {
          if (tab !== 'landing' && !user) { setAuthModal('login'); return; }
          setCurrentTab(tab);
        }}
        user={user}
        isAdmin={user?.role === 'admin'}
        onOpenSubscription={() => (user ? setIsSubscriptionOpen(true) : setAuthModal('login'))}
        onOpenLegal={() => setIsLegalOpen(true)}
        onSignIn={() => setAuthModal('login')}
        onSignOut={handleLogout}
        hasActiveProject={hasActiveProject}
      />

      <main className="flex-1 flex flex-col">
        {currentTab === 'landing' && (
          <LandingPage onStartAnalysis={handleStartAnalysis} onSelectSample={(video) => handleStartAnalysis(video.url)} isProcessing={isProcessing} onOpenLegal={() => setIsLegalOpen(true)} onOpenSettings={() => setIsSettingsOpen(true)} />
        )}

        {currentTab === 'clips' && activeProject && (
          <ClipCandidateList
            project={activeProject}
            onSelectClipForStudio={(c) => { setActiveClipId(c.id); setCurrentTab('studio'); }}
            onQuickExport={(c) => setExportModalClip(c)}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onBatchExport={(clips) => { if (clips[0]) setExportModalClip(clips[0]); setCurrentTab('clips'); }}
            onOpenSocialModal={(c) => setSocialModalClip(c)}
          />
        )}

        {currentTab === 'studio' && activeClip && activeProject && (
          <VideoStudio
            clip={activeClip}
            allClips={activeProject.clips}
            onSelectClip={(c) => setActiveClipId(c.id)}
            onUpdateClip={handleUpdateClip}
            onTrimClip={handleTrimClip}
            onExport={(c) => setExportModalClip(c)}
            onOpenSocial={(c) => setSocialModalClip(c)}
            onBackToClips={() => setCurrentTab('clips')}
          />
        )}

        {currentTab === 'projects' && (
          <ProjectsDashboard
            projects={projects}
            activeProjectId={activeProjectId}
            onOpenProject={(p) => void openProjectById(p.id)}
            onDuplicateProject={handleDuplicateProject}
            onDeleteProject={handleDeleteProject}
            onRenameProject={handleRenameProject}
            onNewProjectClick={() => setCurrentTab('landing')}
          />
        )}

        {currentTab === 'queue' && (
          <QueueDashboard onOpenProject={(id) => void openProjectById(id)} onNavigateLanding={() => setCurrentTab('landing')} />
        )}

        {currentTab === 'templates' && (
          <TemplatesGallery onSelectTemplate={handleApplyTemplate} hasActiveClip={Boolean(activeClip)} onNavigateLanding={() => setCurrentTab('landing')} />
        )}

        {currentTab === 'exports' && (
          <DownloadCenter onNavigateLanding={() => setCurrentTab('landing')} onError={(message) => notify('error', message)} />
        )}

        {currentTab === 'admin' && user?.role === 'admin' && <AdminDashboard onError={(message) => notify('error', message)} />}
      </main>

      {isProcessing && (
        <ProcessingModal
          videoInfo={processingProject?.videoInfo ?? null}
          currentStepIndex={processingStepIndex}
          progressPercent={processingProgress}
          currentLog={processingLog}
          onCancel={handleCancelProcessing}
        />
      )}

      <ClipSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        contentGoal={contentGoal} setContentGoal={setContentGoal}
        hookType={hookType} setHookType={setHookType}
        preferredDuration={preferredDuration} setPreferredDuration={setPreferredDuration}
        aspectRatio={aspectRatio} setAspectRatio={setAspectRatio}
        editingPreset={editingPreset} setEditingPreset={setEditingPreset}
        requestedClipCount={requestedClipCount} setRequestedClipCount={setRequestedClipCount}
        onApplyAndRegenerate={() => { if (activeProject) handleStartAnalysis(activeProject.videoInfo.url); setIsSettingsOpen(false); }}
      />

      <SocialPackModal clip={socialModalClip} onClose={() => setSocialModalClip(null)} />

      {exportModalClip && activeProject && (
        <ExportModal
          clip={exportModalClip}
          projectId={activeProject.id}
          plan={user?.plan ?? 'free'}
          onClose={() => setExportModalClip(null)}
          onExported={() => { void refreshUsage(); notify('success', 'Export ready in the Exports tab.'); }}
          onError={(message) => notify('error', message)}
        />
      )}

      {user && (
        <SubscriptionModal isOpen={isSubscriptionOpen} onClose={() => setIsSubscriptionOpen(false)} user={user} onUpdatePlan={() => notify('success', 'Plan changes are managed by an administrator in this build.')} />
      )}

      <LegalNoticeModal isOpen={isLegalOpen} onClose={() => setIsLegalOpen(false)} />

      <AuthModal
        isOpen={authModal !== null}
        mode={authModal ?? 'login'}
        registrationOpen={registrationOpen}
        onClose={() => setAuthModal(null)}
        onAuthenticated={handleAuthenticated}
      />

      {toast && (
        <div className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl text-sm font-medium shadow-xl border ${toast.kind === 'error' ? 'bg-rose-950/90 border-rose-500/40 text-rose-200' : 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'}`} role="status">
          {toast.message}
        </div>
      )}
    </div>
  );
}
