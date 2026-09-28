import React, { useState } from 'react';
import {
  Sparkles,
  Play,
  Film,
  Download,
  Share2,
  CheckSquare,
  Square,
  Sliders,
  Flame,
  Clock,
  TrendingUp,
  MessageSquare,
  HelpCircle,
  ExternalLink,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { ClipCandidate, Project, ClipStyle } from '../types';

interface ClipCandidateListProps {
  project: Project;
  onSelectClipForStudio: (clip: ClipCandidate) => void;
  onQuickExport: (clip: ClipCandidate) => void;
  onOpenSettings: () => void;
  onBatchExport: (selectedClips: ClipCandidate[]) => void;
  onOpenSocialModal: (clip: ClipCandidate) => void;
}

export const ClipCandidateList: React.FC<ClipCandidateListProps> = ({
  project,
  onSelectClipForStudio,
  onQuickExport,
  onOpenSettings,
  onBatchExport,
  onOpenSocialModal,
}) => {
  const [selectedIds, setSelectedIds] = useState<string[]>(project.clips.map(c => c.id));
  const [styleFilter, setStyleFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'score' | 'duration' | 'time'>('score');
  const [activePreviewClip, setActivePreviewClip] = useState<ClipCandidate | null>(null);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (selectedIds.length === project.clips.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(project.clips.map(c => c.id));
    }
  };

  // Filter & sort
  let filtered = project.clips.filter(c => {
    if (styleFilter === 'all') return true;
    return c.clipStyle === styleFilter;
  });

  filtered.sort((a, b) => {
    if (sortBy === 'score') return b.score - a.score;
    if (sortBy === 'duration') return b.duration - a.duration;
    return a.startTime - b.startTime;
  });

  const selectedClips = project.clips.filter(c => selectedIds.includes(c.id));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
      {/* Top Banner / Video Context Header */}
      <div className="p-6 rounded-3xl glass-panel border border-white/10 mb-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-xl">
        <div className="flex items-center gap-4 min-w-0">
          <div className="relative w-28 h-18 rounded-2xl overflow-hidden shrink-0 bg-slate-900 border border-white/10 shadow-md">
            <img
              src={project.videoInfo.thumbnailUrl}
              alt={project.videoInfo.title}
              className="w-full h-full object-cover"
            />
            <span className="absolute bottom-1 right-1 px-1.5 py-0.2 rounded bg-black/80 text-[10px] font-mono text-white font-semibold">
              {project.videoInfo.durationFormatted}
            </span>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold text-[11px] border border-emerald-500/30">
                ✓ AI Analysis Complete
              </span>
              <span className="text-xs text-slate-400 font-mono">
                {project.videoInfo.resolution}
              </span>
            </div>
            <h1 className="text-xl font-extrabold text-white truncate max-w-2xl">
              {project.name}
            </h1>
            <p className="text-xs text-slate-400">
              Channel: <span className="text-slate-200">{project.videoInfo.channel}</span> • Goal: <span className="text-purple-300 capitalize">{project.contentGoal}</span> • Hook: <span className="text-pink-300 capitalize">{project.hookType}</span>
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          <button
            onClick={onOpenSettings}
            className="flex-1 md:flex-none px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-300 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-purple-400/40 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Sliders className="w-4 h-4 text-purple-400" />
            <span>Viral Settings</span>
          </button>

          <button
            onClick={() => onBatchExport(selectedClips)}
            disabled={selectedClips.length === 0}
            className="flex-1 md:flex-none px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-purple-600 via-indigo-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-40 shadow-lg shadow-purple-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Generate Selected ({selectedClips.length})</span>
          </button>
        </div>
      </div>

      {/* Headline & Filter bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-extrabold text-white flex items-center gap-2">
            <span>We found {project.clips.length} potential clips</span>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          </h2>
          <p className="text-xs text-slate-400">
            Ranked by AI virality score, retention likelihood, and hook sharpness
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          {/* Select all toggle */}
          <button
            onClick={handleSelectAll}
            className="text-xs text-slate-300 hover:text-white px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            {selectedIds.length === project.clips.length ? (
              <CheckSquare className="w-3.5 h-3.5 text-purple-400" />
            ) : (
              <Square className="w-3.5 h-3.5 text-slate-400" />
            )}
            <span>Select All</span>
          </button>

          {/* Sort By */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="bg-black/50 text-slate-300 text-xs px-3 py-1.5 rounded-lg border border-white/10 focus:outline-none focus:border-purple-400 font-sans cursor-pointer"
          >
            <option value="score">Sort by: Highest Viral Score</option>
            <option value="duration">Sort by: Duration</option>
            <option value="time">Sort by: Video Order</option>
          </select>
        </div>
      </div>

      {/* Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
        {filtered.map((clip, idx) => {
          const isSelected = selectedIds.includes(clip.id);
          const scoreColor =
            clip.score >= 90
              ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
              : clip.score >= 80
              ? 'text-amber-400 bg-amber-500/10 border-amber-500/30'
              : 'text-blue-400 bg-blue-500/10 border-blue-500/30';

          return (
            <div
              key={clip.id}
              className={`rounded-3xl glass-card border transition-all p-5 sm:p-6 relative flex flex-col justify-between ${
                isSelected
                  ? 'border-purple-500/50 shadow-xl shadow-purple-500/10 ring-1 ring-purple-500/30'
                  : 'border-white/5 hover:border-white/15'
              }`}
            >
              {/* Card Top: Header & Score */}
              <div>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => toggleSelect(clip.id)}
                      className="cursor-pointer text-slate-400 hover:text-white transition-colors"
                    >
                      {isSelected ? (
                        <CheckSquare className="w-5 h-5 text-purple-400" />
                      ) : (
                        <Square className="w-5 h-5 text-slate-500" />
                      )}
                    </button>

                    <div>
                      <span className="text-[11px] font-mono text-purple-400 font-bold uppercase tracking-wider">
                        Clip #0{idx + 1}
                      </span>
                      <h3 className="text-base font-bold text-white line-clamp-1">
                        {clip.title}
                      </h3>
                    </div>
                  </div>

                  {/* Viral Score Pill */}
                  <div
                    className={`px-3 py-1 rounded-xl border text-xs font-mono font-extrabold flex items-center gap-1.5 shadow-sm shrink-0 ${scoreColor}`}
                  >
                    <Flame className="w-3.5 h-3.5 fill-current" />
                    <span>Score: {clip.score}/100</span>
                  </div>
                </div>

                {/* Video Preview thumbnail with play trigger */}
                <div
                  onClick={() => setActivePreviewClip(clip)}
                  className="relative aspect-video rounded-2xl overflow-hidden bg-black/60 border border-white/10 mb-4 cursor-pointer group shadow-inner"
                >
                  <img
                    src={clip.thumbnailUrl}
                    alt={clip.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-80"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                  {/* Play Button Overlay */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-12 h-12 rounded-full bg-purple-600/90 group-hover:bg-purple-500 group-hover:scale-110 text-white flex items-center justify-center shadow-lg transition-all">
                      <Play className="w-5 h-5 fill-white ml-0.5" />
                    </div>
                  </div>

                  {/* Duration & Time Range Tag */}
                  <div className="absolute bottom-3 left-3 flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-lg bg-black/80 backdrop-blur-sm text-[11px] font-mono font-semibold text-slate-200 border border-white/10 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-purple-400" />
                      {clip.duration}s
                    </span>
                    <span className="px-2 py-0.5 rounded-lg bg-black/80 backdrop-blur-sm text-[11px] font-mono text-slate-300 border border-white/10">
                      {Math.floor(clip.startTime / 60)}:{(clip.startTime % 60).toString().padStart(2, '0')} -{' '}
                      {Math.floor(clip.endTime / 60)}:{(clip.endTime % 60).toString().padStart(2, '0')}
                    </span>
                  </div>

                  {/* 9:16 Badge */}
                  <div className="absolute top-3 right-3 px-2 py-0.5 rounded-lg bg-purple-950/80 backdrop-blur-sm text-[10px] font-extrabold text-purple-200 border border-purple-500/30">
                    9:16 Vertical
                  </div>
                </div>

                {/* Hook Highlight Block */}
                <div className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/5 mb-3">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-pink-400 mb-1">
                    <Sparkles className="w-3 h-3" />
                    <span>Viral Hook Formula</span>
                  </div>
                  <p className="text-xs font-semibold text-slate-100 italic leading-relaxed">
                    "{clip.hook}"
                  </p>
                </div>

                {/* AI Virality Reason & Emotion */}
                <div className="space-y-1.5 mb-4 text-xs">
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Topic:</span>
                    <span className="text-slate-200 font-medium truncate max-w-[200px]">{clip.topic}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Emotion:</span>
                    <span className="text-indigo-300 font-medium">{clip.emotion}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Estimated Virality:</span>
                    <span className="text-emerald-400 font-semibold">{clip.estimatedEngagement}</span>
                  </div>
                </div>

                {/* Selection Reason */}
                <div className="text-[11px] text-slate-400 bg-black/30 p-2.5 rounded-xl border border-white/5 mb-4">
                  <span className="text-slate-300 font-semibold">Why AI selected this: </span>
                  {clip.viralityReason}
                </div>
              </div>

              {/* Bottom Buttons */}
              <div className="flex items-center gap-2 pt-2 border-t border-white/5">
                <button
                  onClick={() => onSelectClipForStudio(clip)}
                  className="flex-1 py-2.5 px-3 rounded-xl text-xs font-bold text-white bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/40 hover:border-purple-400 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Film className="w-3.5 h-3.5 text-purple-300" />
                  <span>Edit Clip</span>
                </button>

                <button
                  onClick={() => onOpenSocialModal(clip)}
                  title="Generate Title & Captions for TikTok, Reels, Shorts"
                  className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 transition-colors cursor-pointer"
                >
                  <Share2 className="w-4 h-4 text-pink-400" />
                </button>

                <button
                  onClick={() => onQuickExport(clip)}
                  className="py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-white/10 hover:bg-white/15 border border-white/10 transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Mini Video Preview Modal if active */}
      {activePreviewClip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl">
          <div className="max-w-md w-full glass-panel rounded-3xl border border-white/15 p-5 shadow-2xl relative">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white truncate">
                {activePreviewClip.title}
              </h3>
              <button
                onClick={() => setActivePreviewClip(null)}
                className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded bg-white/5"
              >
                Close
              </button>
            </div>

            <div className="relative aspect-[9/16] w-full max-h-[65vh] rounded-2xl overflow-hidden bg-black border border-white/10 shadow-2xl flex items-center justify-center mx-auto mb-4">
              <video
                src={activePreviewClip.videoUrl}
                controls
                autoPlay
                className="w-full h-full object-cover scale-[1.35]"
              />
              <div className="absolute bottom-12 left-4 right-4 text-center pointer-events-none">
                <span className="bg-black/70 px-2.5 py-1 rounded font-extrabold text-white text-xs uppercase border border-white/10">
                  {activePreviewClip.hook}
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  onSelectClipForStudio(activePreviewClip);
                  setActivePreviewClip(null);
                }}
                className="flex-1 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 font-bold text-xs text-white"
              >
                Open in Full Video Studio
              </button>
              <button
                onClick={() => {
                  onQuickExport(activePreviewClip);
                  setActivePreviewClip(null);
                }}
                className="py-2 px-4 rounded-xl bg-white/10 hover:bg-white/20 font-bold text-xs text-white"
              >
                Export Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
