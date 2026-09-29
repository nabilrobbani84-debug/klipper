import React, { useState } from 'react';
import {
  X,
  Download,
  Film,
  Sparkles,
  CheckCircle2,
  Clock,
  Layers,
  Cpu,
  Share2,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { ClipCandidate, ExportRecord } from '../types';
import { renderAndExportClip, triggerDownload } from '../services/exportService';

interface ExportModalProps {
  clip: ClipCandidate | null;
  onClose: () => void;
  onExportSuccess: (record: ExportRecord) => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  clip,
  onClose,
  onExportSuccess,
}) => {
  if (!clip) return null;

  const [resolution, setResolution] = useState<'720p' | '1080p' | '1440p' | '4K'>('1080p');
  const [fps, setFps] = useState<number>(60);
  const [format, setFormat] = useState<'mp4' | 'mov'>('mp4');
  const [codec, setCodec] = useState<'h264' | 'h265'>('h264');
  const [renderEngine, setRenderEngine] = useState<'server-ffmpeg' | 'client-canvas'>('server-ffmpeg');

  const [isExporting, setIsExporting] = useState(false);
  const [stage, setStage] = useState<'idle' | 'rendering' | 'encoding' | 'finalizing' | 'ready'>('idle');
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [exportedItem, setExportedItem] = useState<ExportRecord | null>(null);

  const handleStartExport = async () => {
    setIsExporting(true);
    setStage('rendering');

    try {
      if (renderEngine === 'server-ffmpeg') {
        // Submit real FFmpeg render job to backend worker queue
        setProgressMessage('Submitting render job to Server Worker Queue...');
        setProgressPercent(10);

        const res = await fetch('/api/jobs/render', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clip,
            resolution,
            aspectRatio: clip.aspectRatio || '9:16',
          }),
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || 'Server render failed');
        }

        const { jobId } = await res.json();

        // Poll job status
        let pollCount = 0;
        const pollInterval = setInterval(async () => {
          pollCount++;
          try {
            const statusRes = await fetch(`/api/jobs/${jobId}`);
            if (statusRes.ok) {
              const { job } = await statusRes.json();
              setProgressPercent(job.progressPercent || 20);
              const lastLog = job.logs?.[job.logs.length - 1]?.message;
              setProgressMessage(lastLog || `FFmpeg worker processing: ${job.currentStage}...`);

              if (job.status === 'completed') {
                clearInterval(pollInterval);
                setStage('ready');
                setProgressPercent(100);

                const item: ExportRecord = {
                  id: job.id,
                  projectId: clip.id,
                  clipId: clip.id,
                  clipTitle: clip.title,
                  projectName: clip.title,
                  thumbnailUrl: job.resultData?.thumbnailUrl || clip.thumbnailUrl,
                  resolution,
                  fps,
                  format,
                  codec,
                  duration: clip.duration,
                  sizeMb: job.resultData?.fileSizeBytes
                    ? Math.round((job.resultData.fileSizeBytes / (1024 * 1024)) * 10) / 10
                    : 18.5,
                  downloadUrl: job.resultData?.exportUrl || clip.videoUrl,
                  createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ', Today',
                  status: 'ready',
                };

                setExportedItem(item);
                onExportSuccess(item);
                setIsExporting(false);

                confetti({
                  particleCount: 85,
                  spread: 75,
                  origin: { y: 0.6 },
                  colors: ['#a855f7', '#ec4899', '#38bdf8', '#10b981'],
                });
              } else if (job.status === 'failed') {
                clearInterval(pollInterval);
                setIsExporting(false);
                alert(`Render job error: ${job.error || 'Unknown worker error'}`);
              }
            }
          } catch (e) {
            console.warn('Poll error:', e);
          }

          if (pollCount > 60) {
            clearInterval(pollInterval);
            setIsExporting(false);
          }
        }, 1000);

        return;
      }

      // Fast Client Canvas Render
      const item = await renderAndExportClip(
        clip,
        resolution,
        fps,
        format,
        codec,
        (currStage, pct, msg) => {
          setStage(currStage);
          setProgressPercent(pct);
          setProgressMessage(msg);
        }
      );

      setExportedItem(item);
      onExportSuccess(item);

      // Trigger celebratory confetti
      confetti({
        particleCount: 75,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#a855f7', '#ec4899', '#38bdf8', '#facc15'],
      });
      setIsExporting(false);
    } catch (err: any) {
      console.error('Export failed', err);
      alert(err.message || 'Export error');
      setIsExporting(false);
    }
  };

  const handleDownloadNow = () => {
    if (exportedItem) {
      const sanitized = exportedItem.clipTitle.replace(/[^a-zA-Z0-9_-]/g, '_');
      triggerDownload(exportedItem.downloadUrl, `${sanitized}_${exportedItem.resolution}.${exportedItem.format}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl">
      <div className="max-w-xl w-full glass-panel rounded-3xl border border-purple-500/30 p-6 sm:p-8 shadow-2xl relative">
        {/* Top Progress bar if rendering */}
        {isExporting && (
          <div
            className="absolute top-0 left-0 h-1.5 bg-gradient-to-r from-purple-500 via-pink-500 to-emerald-400 transition-all duration-200"
            style={{ width: `${progressPercent}%` }}
          />
        )}

        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-300">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Export Video Clip</h2>
              <p className="text-xs text-slate-400">
                Render vertical 9:16 short with embedded captions & audio profile
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isExporting}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Selected Clip Info Box */}
        <div className="p-3 rounded-2xl bg-black/40 border border-white/10 flex items-center gap-3 mb-6">
          <img
            src={clip.thumbnailUrl}
            alt={clip.title}
            className="w-16 h-12 rounded-xl object-cover"
          />
          <div className="min-w-0 flex-1">
            <h4 className="text-xs font-bold text-white truncate">{clip.title}</h4>
            <div className="text-[11px] text-slate-400">
              Duration: {clip.duration}s • Aspect: {clip.aspectRatio} • Score: {clip.score}
            </div>
          </div>
        </div>

        {/* When NOT exporting and NOT ready: Configuration Selectors */}
        {!isExporting && stage !== 'ready' && (
          <div className="space-y-4 mb-6">
            {/* Render Engine Toggle */}
            <div>
              <label className="text-[11px] font-bold text-slate-300 block mb-2 flex items-center justify-between">
                <span>Rendering Pipeline Engine</span>
                <span className="text-[10px] text-purple-300 font-mono">Backend Worker vs Browser</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRenderEngine('server-ffmpeg')}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    renderEngine === 'server-ffmpeg'
                      ? 'bg-purple-600/20 border-purple-500 text-white shadow-md'
                      : 'bg-white/[0.02] border-white/5 text-slate-400 hover:border-white/20'
                  }`}
                >
                  <div className="font-bold text-xs flex items-center gap-1.5 mb-1 text-purple-200">
                    <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Server FFmpeg (Recommended)</span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-tight">
                    -14 LUFS loudnorm audio, 9:16 smart reframe crop, burn-in captions, uploaded to Object Storage
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setRenderEngine('client-canvas')}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    renderEngine === 'client-canvas'
                      ? 'bg-purple-600/20 border-purple-500 text-white shadow-md'
                      : 'bg-white/[0.02] border-white/5 text-slate-400 hover:border-white/20'
                  }`}
                >
                  <div className="font-bold text-xs flex items-center gap-1.5 mb-1 text-slate-200">
                    <Sparkles className="w-3.5 h-3.5 text-pink-400" />
                    <span>Client Fast Canvas</span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-tight">
                    Instant in-browser frame capture for quick local testing without server queue
                  </p>
                </button>
              </div>
            </div>

            {/* Resolution */}
            <div>
              <label className="text-[11px] font-bold text-slate-300 block mb-2">
                Output Resolution
              </label>
              <div className="grid grid-cols-4 gap-2">
                {(['720p', '1080p', '1440p', '4K'] as const).map((res) => (
                  <button
                    key={res}
                    onClick={() => setResolution(res)}
                    className={`py-2 rounded-xl text-xs font-bold border transition-all ${
                      resolution === res
                        ? 'bg-purple-600/30 border-purple-400 text-white'
                        : 'bg-white/[0.02] border-white/5 text-slate-400 hover:text-white'
                    }`}
                  >
                    {res}
                  </button>
                ))}
              </div>
            </div>

            {/* FPS & Format */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-bold text-slate-300 block mb-2">
                  Frame Rate (FPS)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[24, 30, 60].map((f) => (
                    <button
                      key={f}
                      onClick={() => setFps(f)}
                      className={`py-2 rounded-xl text-xs font-bold border transition-all ${
                        fps === f
                          ? 'bg-purple-600/30 border-purple-400 text-white'
                          : 'bg-white/[0.02] border-white/5 text-slate-400 hover:text-white'
                      }`}
                    >
                      {f} fps
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-300 block mb-2">
                  Container Format
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['mp4', 'mov'] as const).map((fmt) => (
                    <button
                      key={fmt}
                      onClick={() => setFormat(fmt)}
                      className={`py-2 rounded-xl text-xs font-bold uppercase border transition-all ${
                        format === fmt
                          ? 'bg-purple-600/30 border-purple-400 text-white'
                          : 'bg-white/[0.02] border-white/5 text-slate-400 hover:text-white'
                      }`}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Codec */}
            <div>
              <label className="text-[11px] font-bold text-slate-300 block mb-2">
                Video Codec
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'h264' as const, label: 'H.264 (Maximum Compatibility)' },
                  { id: 'h265' as const, label: 'H.265 / HEVC (High Efficiency)' },
                ].map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setCodec(c.id)}
                    className={`p-2.5 rounded-xl text-left border text-xs font-semibold transition-all ${
                      codec === c.id
                        ? 'bg-purple-600/30 border-purple-400 text-white'
                        : 'bg-white/[0.02] border-white/5 text-slate-400 hover:text-white'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Rendering Pipeline Stages Indicator */}
        {isExporting && (
          <div className="my-6 space-y-4">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-bold uppercase tracking-wider">
                Progress: {stage}
              </span>
              <span className="text-purple-300 font-mono font-bold text-sm">
                {progressPercent}%
              </span>
            </div>

            <div className="w-full bg-black/60 h-2.5 rounded-full overflow-hidden border border-white/10 p-0.5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-purple-500 via-pink-500 to-emerald-400 transition-all duration-150"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <p className="text-xs text-slate-300 font-mono bg-black/40 p-3 rounded-xl border border-white/5">
              {progressMessage}
            </p>

            <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-mono">
              <span className={progressPercent >= 20 ? 'text-emerald-400 font-bold' : 'text-slate-600'}>
                1. Rendering
              </span>
              <span className={progressPercent >= 60 ? 'text-emerald-400 font-bold' : 'text-slate-600'}>
                2. Encoding
              </span>
              <span className={progressPercent >= 90 ? 'text-emerald-400 font-bold' : 'text-slate-600'}>
                3. Finalizing
              </span>
            </div>
          </div>
        )}

        {/* Ready State */}
        {stage === 'ready' && exportedItem && (
          <div className="my-6 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-white">Video Ready to Publish!</h3>
              <p className="text-xs text-slate-400">
                {exportedItem.resolution} • {exportedItem.fps}fps • {exportedItem.sizeMb}MB • {exportedItem.format.toUpperCase()}
              </p>
            </div>

            <button
              onClick={handleDownloadNow}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-extrabold text-sm shadow-xl shadow-emerald-500/30 flex items-center justify-center gap-2 cursor-pointer transition-all"
            >
              <Download className="w-5 h-5" />
              <span>Download Video File ({exportedItem.sizeMb} MB)</span>
            </button>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
          <button
            onClick={onClose}
            disabled={isExporting}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-colors disabled:opacity-40"
          >
            {stage === 'ready' ? 'Close' : 'Cancel'}
          </button>

          {!isExporting && stage !== 'ready' && (
            <button
              onClick={handleStartExport}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-purple-600/30 flex items-center gap-2 cursor-pointer transition-all"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Start Export</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
