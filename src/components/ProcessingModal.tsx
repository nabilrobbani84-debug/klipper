import React from 'react';
import {
  CheckCircle2,
  Clock,
  Sparkles,
  Layers,
  Cpu,
  Video,
  Terminal,
  Activity,
} from 'lucide-react';
import { YouTubeVideoInfo } from '../types';
import { PROCESSING_STEPS } from '../services/aiClipService';

interface ProcessingModalProps {
  videoInfo: YouTubeVideoInfo | null;
  currentStepIndex: number;
  progressPercent: number;
  currentLog: string;
  onCancel: () => void;
}

export const ProcessingModal: React.FC<ProcessingModalProps> = ({
  videoInfo,
  currentStepIndex,
  progressPercent,
  currentLog,
  onCancel,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl">
      <div className="max-w-2xl w-full glass-panel rounded-3xl border border-purple-500/30 p-6 sm:p-8 shadow-2xl relative overflow-hidden">
        {/* Top Glow bar */}
        <div
          className="absolute top-0 left-0 h-1.5 bg-gradient-to-r from-purple-500 via-pink-500 to-indigo-500 transition-all duration-300"
          style={{ width: `${progressPercent}%` }}
        />

        {/* Modal Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <span>AI is watching your video...</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-mono">
                  {progressPercent}%
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Finding viral hooks, emotional peaks, and optimal 9:16 cuts
              </p>
            </div>
          </div>

          <button
            onClick={onCancel}
            className="text-xs text-slate-400 hover:text-white px-2.5 py-1 rounded-lg hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
        </div>

        {/* Video Metadata Card */}
        {videoInfo && (
          <div className="mb-6 p-3.5 rounded-2xl bg-black/40 border border-white/10 flex items-center gap-4">
            <div className="relative w-28 h-16 rounded-xl overflow-hidden shrink-0 bg-slate-900 border border-white/10">
              <img
                src={videoInfo.thumbnailUrl}
                alt={videoInfo.title}
                className="w-full h-full object-cover"
              />
              <span className="absolute bottom-1 right-1 px-1.5 py-0.2 rounded bg-black/80 text-[10px] font-mono text-white">
                {videoInfo.durationFormatted}
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-semibold text-white truncate mb-1">
                {videoInfo.title}
              </h4>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                <span className="text-slate-300">{videoInfo.channel}</span>
                <span>•</span>
                <span>{videoInfo.resolution}</span>
                <span>•</span>
                <span>{videoInfo.viewsFormatted}</span>
              </div>
            </div>
          </div>
        )}

        {/* Progress Tracker Steps */}
        <div className="mb-6 space-y-2 max-h-56 overflow-y-auto pr-1">
          {PROCESSING_STEPS.map((step, idx) => {
            const isCompleted = idx < currentStepIndex;
            const isCurrent = idx === currentStepIndex;
            const isPending = idx > currentStepIndex;

            return (
              <div
                key={idx}
                className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-all ${
                  isCurrent
                    ? 'bg-purple-600/20 text-purple-200 border border-purple-500/40 shadow-sm'
                    : isCompleted
                    ? 'text-slate-300 bg-white/[0.02]'
                    : 'text-slate-500'
                }`}
              >
                <div className="flex items-center gap-3">
                  {isCompleted ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : isCurrent ? (
                    <div className="w-4 h-4 rounded-full border-2 border-purple-400 border-t-transparent animate-spin shrink-0" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-slate-600 shrink-0" />
                  )}
                  <span className={isCurrent ? 'font-bold' : ''}>{step}</span>
                </div>

                <div className="text-[11px] font-mono">
                  {isCompleted ? (
                    <span className="text-emerald-400 font-semibold">Done</span>
                  ) : isCurrent ? (
                    <span className="text-purple-300 animate-pulse">Processing...</span>
                  ) : (
                    <span className="text-slate-600">Pending</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Dynamic AI Terminal Output */}
        <div className="rounded-xl bg-black/60 border border-white/10 p-3 font-mono text-[11px] text-slate-300 flex items-start gap-2">
          <Terminal className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1 truncate">
            <span className="text-purple-400 font-bold">$ </span>
            <span className="text-slate-200">{currentLog || 'Initializing AI model runtime...'}</span>
          </div>
          <Activity className="w-3.5 h-3.5 text-emerald-400 shrink-0 animate-pulse" />
        </div>
      </div>
    </div>
  );
};
