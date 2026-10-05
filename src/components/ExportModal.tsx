import React, { useState } from 'react';
import { X, Download, Film, Sparkles, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import confetti from 'canvas-confetti';
import { ClipCandidate } from '../types';
import { BackendExport, getExportForJob, requestExport, watchBackendJob } from '../services/apiClient';

interface ExportModalProps {
  clip: ClipCandidate;
  projectId: string;
  plan: 'free' | 'creator' | 'pro';
  onClose: () => void;
  onExported: (record: BackendExport) => void;
  onError: (message: string) => void;
}

type Resolution = '720p' | '1080p' | '1440p' | '4K';
const PLAN_MAX: Record<ExportModalProps['plan'], Resolution> = { free: '720p', creator: '1080p', pro: '4K' };
const RES_ORDER: Resolution[] = ['720p', '1080p', '1440p', '4K'];

const STAGE_LABEL: Record<string, string> = {
  QUEUED: 'Queued', DOWNLOADING: 'Preparing source', REFRAMING: 'Reframing', GENERATING_CAPTIONS: 'Captions',
  RENDERING: 'Encoding (FFmpeg)', UPLOADING: 'Uploading', COMPLETED: 'Done', FAILED: 'Failed', CANCELLED: 'Cancelled',
};

export const ExportModal: React.FC<ExportModalProps> = ({ clip, projectId, plan, onClose, onExported, onError }) => {
  const maxRes = PLAN_MAX[plan];
  const allowed = RES_ORDER.slice(0, RES_ORDER.indexOf(maxRes) + 1);
  const [resolution, setResolution] = useState<Resolution>(allowed[allowed.length - 1]);
  const [fps, setFps] = useState<24 | 30 | 60>(30);
  const [format, setFormat] = useState<'mp4' | 'mov'>('mp4');
  const [codec, setCodec] = useState<'h264' | 'h265'>('h264');
  const [quality, setQuality] = useState<'draft' | 'standard' | 'high' | 'ultra'>('standard');

  const [phase, setPhase] = useState<'config' | 'rendering' | 'ready'>('config');
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('QUEUED');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<BackendExport | null>(null);

  const start = async () => {
    setPhase('rendering');
    setProgress(0);
    setMessage('Submitting render job…');
    try {
      const { jobId } = await requestExport(projectId, clip.id, { resolution, fps, format, codec, quality, aspectRatio: clip.aspectRatio });
      const finished = await watchBackendJob(jobId, (job) => { setProgress(job.progress); setStage(job.state); setMessage(job.message); });
      if (finished.state !== 'COMPLETED') throw new Error(finished.message || 'Rendering failed.');
      const record = await getExportForJob(jobId);
      setResult(record);
      setPhase('ready');
      onExported(record);
      confetti({ particleCount: 70, spread: 70, origin: { y: 0.6 }, colors: ['#a855f7', '#ec4899', '#38bdf8', '#facc15'] });
    } catch (error) {
      setPhase('config');
      onError(error instanceof Error ? error.message : 'Export failed.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl" role="dialog" aria-modal="true">
      <div className="max-w-xl w-full glass-panel rounded-3xl border border-purple-500/30 p-6 sm:p-8 shadow-2xl relative">
        <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-300"><Film className="w-5 h-5" /></div>
            <div>
              <h2 className="text-xl font-bold text-white">Export clip</h2>
              <p className="text-xs text-slate-400">Server-rendered {clip.aspectRatio} with captions and audio cleanup</p>
            </div>
          </div>
          <button onClick={onClose} disabled={phase === 'rendering'} aria-label="Close" className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors disabled:opacity-40"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-3 rounded-2xl bg-black/40 border border-white/10 flex items-center gap-3 mb-6">
          {clip.thumbnailUrl ? <img src={clip.thumbnailUrl} alt="" className="w-16 h-12 rounded-xl object-cover" /> : <div className="w-16 h-12 rounded-xl bg-slate-800" />}
          <div className="min-w-0 flex-1">
            <h4 className="text-xs font-bold text-white truncate">{clip.title}</h4>
            <div className="text-[11px] text-slate-400">{Math.round(clip.duration)}s • {clip.aspectRatio} • score {clip.score}</div>
          </div>
        </div>

        {phase === 'config' && (
          <div className="space-y-4 mb-6">
            <div>
              <label className="text-[11px] font-bold text-slate-300 block mb-2">Resolution <span className="text-slate-500 font-normal">({plan} plan up to {maxRes})</span></label>
              <div className="grid grid-cols-4 gap-2">
                {RES_ORDER.map((res) => {
                  const locked = !allowed.includes(res);
                  return (
                    <button key={res} disabled={locked} onClick={() => setResolution(res)} className={`py-2 rounded-xl text-xs font-bold border transition-all ${resolution === res ? 'bg-purple-600/30 border-purple-400 text-white' : locked ? 'bg-white/[0.01] border-white/5 text-slate-600 cursor-not-allowed' : 'bg-white/[0.02] border-white/5 text-slate-400 hover:text-white cursor-pointer'}`}>{res}</button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-bold text-slate-300 block mb-2">Frame rate</label>
                <div className="grid grid-cols-3 gap-2">
                  {([24, 30, 60] as const).map((f) => <button key={f} onClick={() => setFps(f)} className={`py-2 rounded-xl text-xs font-bold border cursor-pointer ${fps === f ? 'bg-purple-600/30 border-purple-400 text-white' : 'bg-white/[0.02] border-white/5 text-slate-400 hover:text-white'}`}>{f}</button>)}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-300 block mb-2">Quality</label>
                <select value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)} className="w-full py-2 px-2 rounded-xl text-xs font-bold border border-white/10 bg-black/40 text-white cursor-pointer">
                  <option value="draft">Draft (fast)</option>
                  <option value="standard">Standard</option>
                  <option value="high">High</option>
                  <option value="ultra">Ultra</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-bold text-slate-300 block mb-2">Format</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['mp4', 'mov'] as const).map((f) => <button key={f} onClick={() => setFormat(f)} className={`py-2 rounded-xl text-xs font-bold uppercase border cursor-pointer ${format === f ? 'bg-purple-600/30 border-purple-400 text-white' : 'bg-white/[0.02] border-white/5 text-slate-400 hover:text-white'}`}>{f}</button>)}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-300 block mb-2">Codec {plan === 'free' && <span className="text-slate-500 font-normal">(H.264)</span>}</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['h264', 'h265'] as const).map((c) => <button key={c} disabled={plan === 'free' && c === 'h265'} onClick={() => setCodec(c)} className={`py-2 rounded-xl text-[11px] font-bold uppercase border ${codec === c ? 'bg-purple-600/30 border-purple-400 text-white' : plan === 'free' && c === 'h265' ? 'bg-white/[0.01] border-white/5 text-slate-600 cursor-not-allowed' : 'bg-white/[0.02] border-white/5 text-slate-400 hover:text-white cursor-pointer'}`}>{c === 'h264' ? 'H.264' : 'H.265'}</button>)}
                </div>
              </div>
            </div>
            {plan === 'free' && <p className="text-[11px] text-amber-300/80 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> Free exports include a small ClipForge watermark.</p>}
          </div>
        )}

        {phase === 'rendering' && (
          <div className="my-6 space-y-4">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-bold uppercase tracking-wider flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {STAGE_LABEL[stage] ?? stage}</span>
              <span className="text-purple-300 font-mono font-bold text-sm">{progress}%</span>
            </div>
            <div className="w-full bg-black/60 h-2.5 rounded-full overflow-hidden border border-white/10 p-0.5">
              <div className="h-full rounded-full bg-gradient-to-r from-purple-500 via-pink-500 to-emerald-400 transition-all duration-200" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs text-slate-300 font-mono bg-black/40 p-3 rounded-xl border border-white/5">{message || 'Working…'}</p>
          </div>
        )}

        {phase === 'ready' && result && (
          <div className="my-6 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 mx-auto"><CheckCircle2 className="w-8 h-8" /></div>
            <div>
              <h3 className="text-lg font-bold text-white">Clip ready!</h3>
              <p className="text-xs text-slate-400">{(result.sizeBytes / 1_000_000).toFixed(1)} MB • {String(result.settings.resolution ?? resolution)} • {String(result.settings.format ?? format).toUpperCase()}</p>
            </div>
            <a href={result.downloadUrl} target="_blank" rel="noopener noreferrer" className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-extrabold text-sm shadow-xl shadow-emerald-500/30 flex items-center justify-center gap-2 cursor-pointer transition-all">
              <Download className="w-5 h-5" /> Download video
            </a>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
          <button onClick={onClose} disabled={phase === 'rendering'} className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-colors disabled:opacity-40 cursor-pointer">{phase === 'ready' ? 'Close' : 'Cancel'}</button>
          {phase === 'config' && (
            <button onClick={start} className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-purple-600/30 flex items-center gap-2 cursor-pointer transition-all">
              <Sparkles className="w-3.5 h-3.5" /> Start export
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
