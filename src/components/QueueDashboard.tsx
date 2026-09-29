import React, { useState, useEffect } from 'react';
import {
  Cpu,
  Layers,
  CheckCircle2,
  Clock,
  AlertCircle,
  RotateCcw,
  XCircle,
  Terminal,
  Activity,
  Download,
  Film,
  HardDrive,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { QueueJob, JobStage, SystemMetrics } from '../types';

interface QueueDashboardProps {
  onSelectProject?: (projectId: string) => void;
  onRefresh?: () => void;
}

const STAGE_LABELS: Record<JobStage, string> = {
  QUEUED: '1. Queued in Worker Pool',
  DOWNLOAD_VIDEO: '2. Downloading YouTube Stream',
  TRANSCRIBE: '3. Neural Multilingual Transcription',
  ANALYZE: '4. 7-Factor Weighted AI Scoring',
  FIND_CLIPS: '5. Ranking High-Retention Moments',
  GENERATE_CAPTIONS: '6. Word-Level Animated Captions',
  GENERATE_BROLL: '7. Smart Reframe & B-Roll Sync',
  RENDER: '8. Server FFmpeg Encoding (-14 LUFS)',
  UPLOAD: '9. Storing to Object Storage & CDN',
  CLEANUP: '10. Purging Scratch Disk Cache',
  COMPLETED: '✓ Pipeline Finished',
  FAILED: '✕ Job Terminated With Error',
};

export const QueueDashboard: React.FC<QueueDashboardProps> = () => {
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchJobsAndMetrics = async () => {
    try {
      const [jobsRes, metricsRes] = await Promise.all([
        fetch('/api/jobs'),
        fetch('/api/metrics'),
      ]);

      if (jobsRes.ok) {
        const data = await jobsRes.json();
        setJobs(data.jobs || []);
        if (!selectedJobId && data.jobs && data.jobs.length > 0) {
          setSelectedJobId(data.jobs[0].id);
        }
      }

      if (metricsRes.ok) {
        const mData = await metricsRes.json();
        setMetrics(mData);
      }
    } catch (err) {
      console.warn('Failed to poll queue jobs:', err);
    }
  };

  useEffect(() => {
    fetchJobsAndMetrics();
    if (!autoRefresh) return;
    const interval = setInterval(fetchJobsAndMetrics, 2000);
    return () => clearInterval(interval);
  }, [autoRefresh, selectedJobId]);

  const handleCancelJob = async (jobId: string) => {
    try {
      await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
      fetchJobsAndMetrics();
    } catch (err) {
      console.error(err);
    }
  };

  const selectedJob = jobs.find(j => j.id === selectedJobId) || jobs[0];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
      {/* Header & Metrics row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-mono text-[11px] font-semibold border border-purple-500/30 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Redis / BullMQ Pipeline
            </span>
            <span className="text-xs text-slate-400">Worker Concurrency: 4 workers</span>
          </div>
          <h1 className="text-2xl font-extrabold text-white flex items-center gap-2.5">
            <Activity className="w-6 h-6 text-purple-400" />
            Background Job Queue & FFmpeg Worker Pool
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              autoRefresh
                ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300'
                : 'bg-slate-800/40 border-white/10 text-slate-400'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-spin' : ''}`} />
            <span>{autoRefresh ? 'Live Polling (2s)' : 'Polling Paused'}</span>
          </button>
        </div>
      </div>

      {/* Metrics Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-8">
        <div className="p-4 rounded-2xl glass-card border border-white/10">
          <div className="text-[11px] text-slate-400 font-semibold mb-1">Total Jobs</div>
          <div className="text-2xl font-extrabold text-white">{metrics?.totalJobs ?? jobs.length}</div>
        </div>
        <div className="p-4 rounded-2xl glass-card border border-emerald-500/20 bg-emerald-500/5">
          <div className="text-[11px] text-emerald-400 font-semibold mb-1">Completed</div>
          <div className="text-2xl font-extrabold text-emerald-300">
            {metrics?.completedJobs ?? jobs.filter(j => j.status === 'completed').length}
          </div>
        </div>
        <div className="p-4 rounded-2xl glass-card border border-amber-500/20 bg-amber-500/5">
          <div className="text-[11px] text-amber-400 font-semibold mb-1">In Processing</div>
          <div className="text-2xl font-extrabold text-amber-300">
            {metrics?.processingJobs ?? jobs.filter(j => j.status === 'processing' || j.status === 'retrying').length}
          </div>
        </div>
        <div className="p-4 rounded-2xl glass-card border border-red-500/20 bg-red-500/5">
          <div className="text-[11px] text-red-400 font-semibold mb-1">Failed / Retries</div>
          <div className="text-2xl font-extrabold text-red-300">
            {metrics?.failedJobs ?? jobs.filter(j => j.status === 'failed').length}
          </div>
        </div>
        <div className="p-4 rounded-2xl glass-card border border-purple-500/20 bg-purple-500/5">
          <div className="text-[11px] text-purple-300 font-semibold mb-1">Avg Render Time</div>
          <div className="text-2xl font-extrabold text-purple-200">
            {metrics?.averageRenderTimeSeconds ?? 14}s
          </div>
        </div>
        <div className="p-4 rounded-2xl glass-card border border-cyan-500/20 bg-cyan-500/5">
          <div className="text-[11px] text-cyan-300 font-semibold mb-1">Storage Buffer</div>
          <div className="text-2xl font-extrabold text-cyan-200">
            {metrics?.storageUsageMb ?? 142} MB
          </div>
        </div>
      </div>

      {/* Main split view: Job List on Left, Selected Job Details & Worker Console on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Job Queue List (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between text-xs font-bold text-slate-300 px-1">
            <span>ACTIVE & RECENT JOBS ({jobs.length})</span>
            <span className="text-slate-500">Click to inspect logs</span>
          </div>

          {jobs.length === 0 ? (
            <div className="p-8 rounded-2xl glass-panel text-center text-slate-400 border border-white/5">
              <Clock className="w-8 h-8 mx-auto text-slate-500 mb-2 opacity-50" />
              <p className="text-sm font-semibold">No active jobs in queue</p>
              <p className="text-xs text-slate-500 mt-1">Submit a YouTube URL from the clipper to start processing</p>
            </div>
          ) : (
            jobs.map((job) => {
              const isSelected = selectedJob?.id === job.id;
              const statusColor =
                job.status === 'completed'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : job.status === 'failed'
                  ? 'border-red-500/40 bg-red-500/10 text-red-300'
                  : job.status === 'retrying'
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  : 'border-purple-500/40 bg-purple-500/10 text-purple-300';

              return (
                <div
                  key={job.id}
                  onClick={() => setSelectedJobId(job.id)}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'glass-panel border-purple-500 shadow-lg shadow-purple-500/10 ring-1 ring-purple-500/50'
                      : 'glass-card border-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider ${statusColor}`}>
                          {job.status}
                        </span>
                        <span className="text-[11px] font-mono text-slate-400">
                          {job.type}
                        </span>
                      </div>
                      <h4 className="text-sm font-bold text-white truncate">
                        {job.videoInfo?.title || job.videoUrl || `Job #${job.id}`}
                      </h4>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-xs font-mono font-bold text-purple-300">
                        {job.progressPercent}%
                      </span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden mb-2.5">
                    <div
                      className={`h-full transition-all duration-300 ${
                        job.status === 'completed'
                          ? 'bg-emerald-400'
                          : job.status === 'failed'
                          ? 'bg-red-500'
                          : 'bg-gradient-to-r from-purple-500 to-pink-500'
                      }`}
                      style={{ width: `${job.progressPercent}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span className="truncate max-w-[200px]">
                      {STAGE_LABELS[job.currentStage] || job.currentStage}
                    </span>
                    <span className="font-mono text-[10px]">
                      {job.currentAttempt > 1 ? `Attempt ${job.currentAttempt}/3` : job.createdAt.slice(11, 19)}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right Column: Selected Job Deep Inspector & Live Worker Console (7 cols) */}
        <div className="lg:col-span-7">
          {selectedJob ? (
            <div className="glass-panel p-6 rounded-3xl border border-white/10 space-y-6">
              {/* Job Header */}
              <div className="flex items-start justify-between gap-4 pb-4 border-b border-white/10">
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="px-2.5 py-0.5 rounded-lg bg-slate-800 text-xs font-mono text-slate-300 border border-white/10">
                      ID: {selectedJob.id}
                    </span>
                    <span className="text-xs text-slate-400">
                      User: {selectedJob.userId}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-white">
                    {selectedJob.videoInfo?.title || selectedJob.videoUrl || selectedJob.id}
                  </h3>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {selectedJob.status === 'processing' && (
                    <button
                      onClick={() => handleCancelJob(selectedJob.id)}
                      className="px-3 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/30 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Cancel</span>
                    </button>
                  )}
                  {selectedJob.resultData?.exportUrl && (
                    <a
                      href={selectedJob.resultData.exportUrl}
                      download
                      className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md transition-all"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download Output</span>
                    </a>
                  )}
                </div>
              </div>

              {/* Pipeline Stage Roadmap */}
              <div>
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">
                  Processing Pipeline Stages
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                  {[
                    'DOWNLOAD_VIDEO',
                    'TRANSCRIBE',
                    'ANALYZE',
                    'FIND_CLIPS',
                    'GENERATE_CAPTIONS',
                    'RENDER',
                  ].map((stg, i) => {
                    const isCurrent = selectedJob.currentStage === stg;
                    const isDone = selectedJob.status === 'completed';

                    return (
                      <div
                        key={stg}
                        className={`p-2.5 rounded-xl border text-[11px] font-semibold flex items-center gap-2 ${
                          isCurrent
                            ? 'bg-purple-500/20 border-purple-500/40 text-purple-200'
                            : isDone
                            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                            : 'bg-slate-900/40 border-white/5 text-slate-500'
                        }`}
                      >
                        {isDone ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        ) : isCurrent ? (
                          <span className="w-2 h-2 rounded-full bg-purple-400 animate-ping shrink-0" />
                        ) : (
                          <span className="w-3.5 h-3.5 rounded-full border border-slate-600 flex items-center justify-center text-[9px] shrink-0">
                            {i + 1}
                          </span>
                        )}
                        <span className="truncate">{stg.replace('_', ' ')}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Worker Output Console Log */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-emerald-400" />
                    Live Worker Execution Stream
                  </h4>
                  <span className="text-[10px] font-mono text-slate-500">
                    {selectedJob.logs?.length || 0} events logged
                  </span>
                </div>

                <div className="h-64 rounded-2xl bg-black/80 border border-white/10 p-3.5 font-mono text-[11px] overflow-y-auto space-y-1.5 shadow-inner">
                  {selectedJob.logs && selectedJob.logs.length > 0 ? (
                    selectedJob.logs.map((log, index) => {
                      const levelColor =
                        log.level === 'error'
                          ? 'text-red-400'
                          : log.level === 'warn'
                          ? 'text-amber-400'
                          : log.level === 'success'
                          ? 'text-emerald-300 font-bold'
                          : 'text-slate-300';

                      return (
                        <div key={index} className="flex items-start gap-2 leading-relaxed">
                          <span className="text-slate-500 shrink-0 select-none">
                            [{log.timestamp}]
                          </span>
                          <span className="px-1 py-0.2 rounded bg-slate-800 text-[10px] text-purple-300 shrink-0">
                            {log.stage}
                          </span>
                          <span className={levelColor}>{log.message}</span>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-slate-500 italic">Awaiting worker telemetry events...</div>
                  )}
                </div>
              </div>

              {/* Results & Object Storage Metadata */}
              {selectedJob.resultData?.clips && (
                <div className="p-4 rounded-2xl bg-purple-950/20 border border-purple-500/20">
                  <div className="flex items-center justify-between">
                    <div>
                      <h5 className="text-xs font-bold text-purple-200">
                        Generated {selectedJob.resultData.clips.length} Viral Moments
                      </h5>
                      <p className="text-[11px] text-slate-400">
                        Stored in Object Storage bucket (projects/) with 30-day retention
                      </p>
                    </div>
                    <span className="px-3 py-1 rounded-xl bg-purple-500/20 text-purple-300 font-semibold text-xs border border-purple-500/30">
                      Top Score: {Math.max(...selectedJob.resultData.clips.map(c => c.score))}/100
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-12 rounded-3xl glass-panel text-center text-slate-400 border border-white/5">
              <Cpu className="w-10 h-10 mx-auto text-slate-600 mb-2 opacity-50" />
              <p className="text-sm font-semibold">Select a job from the queue to view its pipeline telemetry</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
