import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  RefreshCw,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { BackendJob, cancelBackendJob, getExportForJob, listJobs, retryBackendJob } from '../services/apiClient';

interface QueueDashboardProps {
  onOpenProject: (projectId: string) => void;
  onNavigateLanding: () => void;
}

const STAGE_LABELS: Record<string, string> = {
  QUEUED: 'Queued',
  DOWNLOADING: 'Downloading source',
  EXTRACTING_AUDIO: 'Extracting audio',
  TRANSCRIBING: 'Transcribing (word timestamps)',
  ANALYZING: 'Finding best moments',
  GENERATING_CLIPS: 'Saving clips',
  REFRAMING: 'Auto-reframe / speaker detection',
  GENERATING_CAPTIONS: 'Generating captions',
  RENDERING: 'FFmpeg encoding',
  UPLOADING: 'Uploading to storage',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

const ACTIVE = ['QUEUED', 'DOWNLOADING', 'EXTRACTING_AUDIO', 'TRANSCRIBING', 'ANALYZING', 'GENERATING_CLIPS', 'REFRAMING', 'GENERATING_CAPTIONS', 'RENDERING', 'UPLOADING'];

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export const QueueDashboard: React.FC<QueueDashboardProps> = ({ onOpenProject, onNavigateLanding }) => {
  const [jobs, setJobs] = useState<BackendJob[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setJobs(await listJobs());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load jobs.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!autoRefresh) return;
    const interval = setInterval(() => void refresh(), 2500);
    return () => clearInterval(interval);
  }, [autoRefresh, refresh]);

  const handleCancel = async (jobId: string) => {
    setBusyId(jobId);
    try {
      await cancelBackendJob(jobId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRetry = async (jobId: string) => {
    setBusyId(jobId);
    try {
      await retryBackendJob(jobId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDownload = async (jobId: string) => {
    try {
      const record = await getExportForJob(jobId);
      window.open(record.downloadUrl, '_blank', 'noopener');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export not available yet.');
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-mono text-[11px] font-semibold border border-purple-500/30 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Processing queue
            </span>
          </div>
          <h1 className="text-2xl font-extrabold text-white flex items-center gap-2.5">
            <Activity className="w-6 h-6 text-purple-400" />
            Jobs &amp; render queue
          </h1>
        </div>
        <button
          onClick={() => setAutoRefresh((value) => !value)}
          className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${autoRefresh ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300' : 'bg-slate-800/40 border-white/10 text-slate-400'}`}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-spin' : ''}`} />
          <span>{autoRefresh ? 'Live (2.5s)' : 'Paused'}</span>
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs mb-4 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {jobs.length === 0 ? (
        <div className="text-center py-16 glass-panel rounded-3xl border border-white/10">
          <Clock className="w-10 h-10 text-slate-500 mx-auto mb-3" />
          <h3 className="text-base font-bold text-white mb-1">No jobs yet</h3>
          <p className="text-sm text-slate-400 mb-5">Paste a YouTube URL to start your first processing job.</p>
          <button onClick={onNavigateLanding} className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold text-xs cursor-pointer">Create a clip</button>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => {
            const isActive = ACTIVE.includes(job.state);
            const isFailed = job.state === 'FAILED' || job.state === 'CANCELLED';
            return (
              <div key={job.id} className="glass-card rounded-2xl border border-white/10 p-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {job.state === 'COMPLETED' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        : isFailed ? <XCircle className="w-4 h-4 text-rose-400" />
                        : <div className="w-4 h-4 rounded-full border-2 border-purple-400 border-t-transparent animate-spin" />}
                      <span className="text-sm font-semibold text-white">{STAGE_LABELS[job.state] ?? job.state}</span>
                      <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-white/5 text-slate-400">{job.kind}</span>
                    </div>
                    <p className="text-xs text-slate-400 truncate">{job.message || '—'}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Updated {relativeTime(job.updatedAt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {job.kind === 'render' && job.state === 'COMPLETED' && (
                      <button onClick={() => handleDownload(job.id)} className="p-2 rounded-lg bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 cursor-pointer" title="Download export"><Download className="w-4 h-4" /></button>
                    )}
                    {job.state === 'COMPLETED' && job.kind === 'analysis' && (
                      <button onClick={() => onOpenProject(job.projectId)} className="px-3 py-1.5 rounded-lg bg-purple-500/20 text-purple-200 text-xs font-semibold hover:bg-purple-500/30 cursor-pointer">Open clips</button>
                    )}
                    {isActive && (
                      <button onClick={() => handleCancel(job.id)} disabled={busyId === job.id} className="p-2 rounded-lg bg-white/5 text-slate-300 hover:bg-rose-500/20 hover:text-rose-300 cursor-pointer disabled:opacity-50" title="Cancel"><XCircle className="w-4 h-4" /></button>
                    )}
                    {isFailed && (
                      <button onClick={() => handleRetry(job.id)} disabled={busyId === job.id} className="p-2 rounded-lg bg-white/5 text-slate-300 hover:bg-purple-500/20 hover:text-purple-300 cursor-pointer disabled:opacity-50" title="Retry"><RotateCcw className="w-4 h-4" /></button>
                    )}
                  </div>
                </div>
                <div className="mt-3 w-full bg-black/50 h-1.5 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${isFailed ? 'bg-rose-500' : 'bg-gradient-to-r from-purple-500 to-emerald-400'}`} style={{ width: `${job.progress}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
