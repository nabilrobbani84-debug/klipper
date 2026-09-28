import React, { useState, useEffect } from 'react';
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
import { TemplatesGallery } from './components/TemplatesGallery';
import { SubscriptionModal } from './components/SubscriptionModal';
import { AdminDashboard } from './components/AdminDashboard';
import { LegalNoticeModal } from './components/LegalNoticeModal';

import {
  Project,
  ClipCandidate,
  YouTubeVideoInfo,
  ExportRecord,
  UserAccount,
  ContentGoal,
  HookType,
  EditingPreset,
  CaptionPreset,
  AspectRatio,
} from './types';

import { SAMPLE_VIDEOS, generateSampleClips } from './data/sampleVideos';
import { fetchVideoMetadata, analyzeVideoWithAI } from './services/aiClipService';
import {
  cancelBackendJob,
  createAnalysisJob,
  getBackendProject,
  isBackendConfigured,
  mapBackendProject,
  watchBackendJob,
} from './services/apiClient';

export default function App() {
  // Navigation State
  const [currentTab, setCurrentTab] = useState<
    'landing' | 'clips' | 'studio' | 'projects' | 'templates' | 'exports' | 'admin'
  >('landing');

  // User Account State
  const [user, setUser] = useState<UserAccount>({
    name: 'Alex Vance',
    email: 'creator@clipforge.ai',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    plan: 'creator',
    credits: 120,
    minutesUsed: 42,
    minutesLimit: 180,
    clipsGenerated: 28,
    storageMbUsed: 215,
    storageMbLimit: 1000,
  });

  // Projects & Active Clip State
  const [projects, setProjects] = useState<Project[]>(() => {
    // Initialize with a rich pre-loaded project
    const defaultVideo = SAMPLE_VIDEOS[0];
    const initialClips = generateSampleClips(defaultVideo);
    return [
      {
        id: `proj-${defaultVideo.id}`,
        name: defaultVideo.title,
        videoInfo: defaultVideo,
        clips: initialClips,
        createdAt: 'Today, 10:15 AM',
        lastEdited: 'Just now',
        status: 'ready',
        contentGoal: 'retention',
        hookType: 'curiosity',
        preferredDuration: 45,
      },
    ];
  });

  const [activeProjectId, setActiveProjectId] = useState<string>(projects[0].id);
  const activeProject = projects.find((p) => p.id === activeProjectId) || projects[0];

  const [activeClipId, setActiveClipId] = useState<string>(
    activeProject?.clips[0]?.id || ''
  );
  const activeClip =
    activeProject?.clips.find((c) => c.id === activeClipId) || activeProject?.clips[0];

  // Processing State
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingVideoInfo, setProcessingVideoInfo] = useState<YouTubeVideoInfo | null>(null);
  const [processingStepIndex, setProcessingStepIndex] = useState(0);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingLog, setProcessingLog] = useState('');
  const [processingJobId, setProcessingJobId] = useState<string | null>(null);

  // Viral AI Settings State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [contentGoal, setContentGoal] = useState<ContentGoal>('retention');
  const [hookType, setHookType] = useState<HookType>('curiosity');
  const [preferredDuration, setPreferredDuration] = useState<number>(45);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [editingPreset, setEditingPreset] = useState<EditingPreset>('dynamic-mrbeast');

  // Modals State
  const [isSubscriptionOpen, setIsSubscriptionOpen] = useState(false);
  const [isLegalOpen, setIsLegalOpen] = useState(false);
  const [socialModalClip, setSocialModalClip] = useState<ClipCandidate | null>(null);
  const [exportModalClip, setExportModalClip] = useState<ClipCandidate | null>(null);

  // Export Records
  const [exports, setExports] = useState<ExportRecord[]>([
    {
      id: 'export-initial-1',
      projectId: projects[0].id,
      clipId: projects[0].clips[0].id,
      clipTitle: projects[0].clips[0].title,
      projectName: projects[0].name,
      thumbnailUrl: projects[0].clips[0].thumbnailUrl,
      resolution: '1080p',
      fps: 60,
      format: 'mp4',
      codec: 'h264',
      duration: projects[0].clips[0].duration,
      sizeMb: 24.8,
      downloadUrl: projects[0].clips[0].videoUrl,
      createdAt: '10:30 AM, Today',
      status: 'ready',
    },
  ]);

  // Handler: Start Analysis from URL
  const handleStartAnalysis = async (url: string) => {
    setIsProcessing(true);
    setProcessingStepIndex(0);
    setProcessingProgress(5);
    setProcessingLog('Parsing URL and verifying access rights...');

    try {
      if (isBackendConfigured()) {
        const queued = await createAnalysisJob({
          youtubeUrl: url,
          contentGoal,
          hookType,
          preferredDuration,
          aspectRatio,
          requestedClipCount: 3,
        });
        setProcessingJobId(queued.jobId);
        setProcessingLog('Job queued. The worker will continue even if this browser tab is closed.');
        const finished = await watchBackendJob(queued.jobId, (job) => {
          const stageIndex: Record<string, number> = {
            QUEUED: 0,
            DOWNLOADING: 1,
            EXTRACTING_AUDIO: 2,
            TRANSCRIBING: 3,
            ANALYZING: 4,
            GENERATING_CLIPS: 5,
            REFRAMING: 6,
            GENERATING_CAPTIONS: 7,
            RENDERING: 8,
            COMPLETED: 8,
          };
          setProcessingStepIndex(stageIndex[job.state] ?? 0);
          setProcessingProgress(job.progress);
          setProcessingLog(job.message);
        });
        if (finished.state !== 'COMPLETED') {
          throw new Error(finished.message || 'Video processing did not complete.');
        }
        const backendProject = await getBackendProject(queued.projectId);
        const newProject = mapBackendProject(backendProject);
        if (newProject.clips.length === 0) throw new Error('The analysis completed without returning clip candidates.');
        setProcessingVideoInfo(newProject.videoInfo);
        setProjects((prev) => [newProject, ...prev]);
        setActiveProjectId(newProject.id);
        setActiveClipId(newProject.clips[0].id);
        setUser((prev) => ({
          ...prev,
          minutesUsed: Math.min(prev.minutesLimit, prev.minutesUsed + Math.round(newProject.videoInfo.durationSeconds / 60)),
          clipsGenerated: prev.clipsGenerated + newProject.clips.length,
        }));
        setCurrentTab('clips');
        return;
      }

      const videoInfo = await fetchVideoMetadata(url);
      setProcessingVideoInfo(videoInfo);

      const generatedClips = await analyzeVideoWithAI(
        videoInfo,
        contentGoal,
        hookType,
        preferredDuration,
        (stepIdx, stepName, pct, logMsg) => {
          setProcessingStepIndex(stepIdx);
          setProcessingProgress(pct);
          setProcessingLog(logMsg);
        }
      );

      const newProject: Project = {
        id: `proj-${Date.now()}`,
        name: videoInfo.title,
        videoInfo,
        clips: generatedClips,
        createdAt: 'Just now',
        lastEdited: 'Just now',
        status: 'ready',
        contentGoal,
        hookType,
        preferredDuration,
      };

      setProjects((prev) => [newProject, ...prev]);
      setActiveProjectId(newProject.id);
      setActiveClipId(generatedClips[0].id);

      // Deduct minutes
      setUser((prev) => ({
        ...prev,
        minutesUsed: Math.min(prev.minutesLimit, prev.minutesUsed + Math.round(videoInfo.durationSeconds / 60)),
        clipsGenerated: prev.clipsGenerated + generatedClips.length,
      }));

      // Navigate to clips list
      setCurrentTab('clips');
    } catch (err: any) {
      alert(err.message || 'An error occurred while analyzing the YouTube video.');
    } finally {
      setIsProcessing(false);
      setProcessingJobId(null);
      setProcessingVideoInfo(null);
    }
  };

  const handleCancelProcessing = async () => {
    if (processingJobId) {
      try {
        await cancelBackendJob(processingJobId);
      } catch (error) {
        alert(error instanceof Error ? error.message : 'The processing job could not be cancelled.');
      }
    }
    setIsProcessing(false);
  };

  // Handler: Quick Sample Select
  const handleSelectSample = (sample: YouTubeVideoInfo) => {
    handleStartAnalysis(sample.url);
  };

  // Handler: Update Clip in active project
  const handleUpdateClip = (updated: ClipCandidate) => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== activeProjectId) return p;
        return {
          ...p,
          lastEdited: 'Just now',
          clips: p.clips.map((c) => (c.id === updated.id ? updated : c)),
        };
      })
    );
  };

  // Handler: Duplicate Project
  const handleDuplicateProject = (p: Project) => {
    const dup: Project = {
      ...p,
      id: `proj-${Date.now()}`,
      name: `${p.name} (Copy)`,
      createdAt: 'Just now',
      lastEdited: 'Just now',
    };
    setProjects((prev) => [dup, ...prev]);
  };

  // Handler: Delete Project
  const handleDeleteProject = (projectId: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    if (activeProjectId === projectId) {
      const remaining = projects.filter((p) => p.id !== projectId);
      if (remaining.length > 0) {
        setActiveProjectId(remaining[0].id);
        setActiveClipId(remaining[0].clips[0]?.id || '');
      }
    }
  };

  // Handler: Rename Project
  const handleRenameProject = (projectId: string, newName: string) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, name: newName } : p))
    );
  };

  // Handler: Apply template to active clip
  const handleApplyTemplate = (
    editingPreset: EditingPreset,
    captionPreset: CaptionPreset,
    color: string
  ) => {
    if (activeClip) {
      const updated: ClipCandidate = {
        ...activeClip,
        editingPreset,
        captions: {
          ...activeClip.captions,
          preset: captionPreset,
          highlightColor: color,
        },
      };
      handleUpdateClip(updated);
      setCurrentTab('studio');
    }
  };

  // Handler: Batch Export
  const handleBatchExport = (selectedClips: ClipCandidate[]) => {
    if (selectedClips.length === 0) return;
    const newExports: ExportRecord[] = selectedClips.map((c) => ({
      id: `export-${Date.now()}-${c.id}`,
      projectId: activeProject.id,
      clipId: c.id,
      clipTitle: c.title,
      projectName: activeProject.name,
      thumbnailUrl: c.thumbnailUrl,
      resolution: '1080p',
      fps: 60,
      format: 'mp4',
      codec: 'h264',
      duration: c.duration,
      sizeMb: Math.round(c.duration * 0.7 * 10) / 10,
      downloadUrl: c.videoUrl,
      createdAt: 'Just now',
      status: 'ready',
    }));

    setExports((prev) => [...newExports, ...prev]);
    setCurrentTab('exports');
  };

  return (
    <div className="min-h-screen bg-[#08090E] text-slate-100 flex flex-col font-sans">
      {/* Top Navigation */}
      <Navbar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        user={user}
        onOpenSubscription={() => setIsSubscriptionOpen(true)}
        onOpenLegal={() => setIsLegalOpen(true)}
        hasActiveProject={Boolean(activeProject && activeProject.clips.length > 0)}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col">
        {/* TAB 1: LANDING PAGE */}
        {currentTab === 'landing' && (
          <LandingPage
            onStartAnalysis={handleStartAnalysis}
            onSelectSample={handleSelectSample}
            isProcessing={isProcessing}
            onOpenLegal={() => setIsLegalOpen(true)}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />
        )}

        {/* TAB 2: AI CLIPS CANDIDATES */}
        {currentTab === 'clips' && activeProject && (
          <ClipCandidateList
            project={activeProject}
            onSelectClipForStudio={(c) => {
              setActiveClipId(c.id);
              setCurrentTab('studio');
            }}
            onQuickExport={(c) => setExportModalClip(c)}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onBatchExport={handleBatchExport}
            onOpenSocialModal={(c) => setSocialModalClip(c)}
          />
        )}

        {/* TAB 3: VIDEO STUDIO EDITOR */}
        {currentTab === 'studio' && activeClip && (
          <VideoStudio
            clip={activeClip}
            allClips={activeProject?.clips || []}
            onSelectClip={(c) => setActiveClipId(c.id)}
            onUpdateClip={handleUpdateClip}
            onExport={(c) => setExportModalClip(c)}
            onOpenSocial={(c) => setSocialModalClip(c)}
            onBackToClips={() => setCurrentTab('clips')}
          />
        )}

        {/* TAB 4: MY PROJECTS */}
        {currentTab === 'projects' && (
          <ProjectsDashboard
            projects={projects}
            activeProjectId={activeProjectId}
            onOpenProject={(p) => {
              setActiveProjectId(p.id);
              if (p.clips.length > 0) setActiveClipId(p.clips[0].id);
              setCurrentTab('clips');
            }}
            onDuplicateProject={handleDuplicateProject}
            onDeleteProject={handleDeleteProject}
            onRenameProject={handleRenameProject}
            onNewProjectClick={() => setCurrentTab('landing')}
          />
        )}

        {/* TAB 5: TEMPLATES GALLERY */}
        {currentTab === 'templates' && (
          <TemplatesGallery
            onSelectTemplate={handleApplyTemplate}
            hasActiveClip={Boolean(activeClip)}
            onNavigateLanding={() => setCurrentTab('landing')}
          />
        )}

        {/* TAB 6: EXPORT CENTER / DOWNLOADS */}
        {currentTab === 'exports' && (
          <DownloadCenter
            exports={exports}
            onDeleteExport={(id) => setExports((prev) => prev.filter((e) => e.id !== id))}
            onNavigateLanding={() => setCurrentTab('landing')}
          />
        )}

        {/* TAB 7: ADMIN DASHBOARD */}
        {currentTab === 'admin' && <AdminDashboard />}
      </main>

      {/* Processing Modal when AI analysis is running */}
      {isProcessing && (
        <ProcessingModal
          videoInfo={processingVideoInfo}
          currentStepIndex={processingStepIndex}
          progressPercent={processingProgress}
          currentLog={processingLog}
          onCancel={handleCancelProcessing}
        />
      )}

      {/* Viral Settings Modal */}
      <ClipSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        contentGoal={contentGoal}
        setContentGoal={setContentGoal}
        hookType={hookType}
        setHookType={setHookType}
        preferredDuration={preferredDuration}
        setPreferredDuration={setPreferredDuration}
        aspectRatio={aspectRatio}
        setAspectRatio={setAspectRatio}
        editingPreset={editingPreset}
        setEditingPreset={setEditingPreset}
        onApplyAndRegenerate={() => {
          if (activeProject) {
            handleStartAnalysis(activeProject.videoInfo.url);
          }
        }}
      />

      {/* Social Media Copy Pack Modal */}
      <SocialPackModal
        clip={socialModalClip}
        onClose={() => setSocialModalClip(null)}
      />

      {/* Export & Render Modal */}
      <ExportModal
        clip={exportModalClip}
        onClose={() => setExportModalClip(null)}
        onExportSuccess={(rec) => {
          setExports((prev) => [rec, ...prev]);
        }}
      />

      {/* Subscription & Usage Modal */}
      <SubscriptionModal
        isOpen={isSubscriptionOpen}
        onClose={() => setIsSubscriptionOpen(false)}
        user={user}
        onUpdatePlan={(p) => setUser((prev) => ({ ...prev, plan: p }))}
      />

      {/* Legal & Compliance Notice Modal */}
      <LegalNoticeModal
        isOpen={isLegalOpen}
        onClose={() => setIsLegalOpen(false)}
      />
    </div>
  );
}
