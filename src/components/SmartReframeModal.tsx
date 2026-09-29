import React, { useState, useEffect } from 'react';
import {
  X,
  Smartphone,
  Users,
  Camera,
  Layers,
  Sparkles,
  Check,
  Sliders,
  Play,
  Pause,
  ArrowRight,
} from 'lucide-react';
import { ClipCandidate, SpeakerCutPoint } from '../types';

interface SmartReframeModalProps {
  clip: ClipCandidate;
  onClose: () => void;
  onApply: (updatedClip: ClipCandidate) => void;
}

export const SmartReframeModal: React.FC<SmartReframeModalProps> = ({
  clip,
  onClose,
  onApply,
}) => {
  const [activeSpeaker, setActiveSpeaker] = useState<'Speaker A' | 'Speaker B'>('Speaker A');
  const [mode, setMode] = useState<'speaker' | 'split-stack' | 'center' | 'manual'>('speaker');
  const [smoothTracking, setSmoothTracking] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackTime, setPlaybackTime] = useState(0);

  const speakerCuts: SpeakerCutPoint[] = clip.smartReframe?.cutPoints || [
    { timestamp: 0, speaker: 'Speaker A', cropPanX: 28, confidence: 0.95 },
    { timestamp: 8, speaker: 'Speaker B', cropPanX: 72, confidence: 0.93 },
    { timestamp: 18, speaker: 'Speaker A', cropPanX: 28, confidence: 0.97 },
    { timestamp: 28, speaker: 'Speaker B', cropPanX: 72, confidence: 0.92 },
  ];

  // Animate playback across speaker turns
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setPlaybackTime(prev => {
        const next = prev >= clip.duration ? 0 : prev + 0.5;
        // Determine current active speaker cut
        const currentCut = [...speakerCuts].reverse().find(c => next >= c.timestamp);
        if (currentCut) {
          setActiveSpeaker(currentCut.speaker === 'Speaker B' ? 'Speaker B' : 'Speaker A');
        }
        return next;
      });
    }, 500);

    return () => clearInterval(interval);
  }, [isPlaying, clip.duration, speakerCuts]);

  const handleSave = () => {
    const updated: ClipCandidate = {
      ...clip,
      reframing: {
        ...clip.reframing,
        mode: mode === 'split-stack' ? 'speaker' : mode,
        panX: activeSpeaker === 'Speaker A' ? 28 : 72,
        smoothTracking,
      },
      smartReframe: {
        mode: mode === 'split-stack' ? 'speaker' : mode,
        speakersDetected: 2,
        activeSpeakerSwitching: mode === 'speaker',
        cutPoints: speakerCuts,
      },
    };
    onApply(updated);
    onClose();
  };

  const cropOffset = activeSpeaker === 'Speaker A' ? '18%' : '52%';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl">
      <div className="max-w-4xl w-full glass-panel rounded-3xl border border-purple-500/30 p-6 sm:p-8 shadow-2xl relative max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-300">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <span>AI Smart Reframe (16:9 → 9:16)</span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold border border-emerald-500/30">
                  Active Speaker Tracking
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Automated multi-speaker face detection and dynamic camera switching
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Visual comparison container */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 mb-6">
          {/* Left: Original 16:9 Video with Face Centroid Detection Boxes (7 cols) */}
          <div className="md:col-span-7 space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-300">
              <span className="flex items-center gap-1.5">
                <Users className="w-4 h-4 text-purple-400" />
                Original 16:9 Studio Video (Face Centroids Detected)
              </span>
              <span className="font-mono text-purple-300 text-[11px]">
                {playbackTime.toFixed(1)}s / {clip.duration}s
              </span>
            </div>

            <div className="relative aspect-video rounded-2xl overflow-hidden bg-slate-950 border border-white/10 shadow-lg">
              <img
                src={clip.thumbnailUrl}
                alt="16:9 Studio"
                className="w-full h-full object-cover opacity-80"
              />

              {/* Speaker A Bounding Box */}
              <div
                className={`absolute top-[20%] left-[22%] w-[22%] h-[55%] rounded-xl border-2 transition-all ${
                  activeSpeaker === 'Speaker A'
                    ? 'border-emerald-400 bg-emerald-500/15 shadow-lg shadow-emerald-500/20 ring-2 ring-emerald-400/50'
                    : 'border-slate-500/50 bg-black/20'
                }`}
              >
                <div className="absolute -top-6 left-0 px-2 py-0.5 rounded bg-emerald-500 text-[10px] font-bold text-black flex items-center gap-1">
                  <span>Person A (Speaking)</span>
                </div>
              </div>

              {/* Speaker B Bounding Box */}
              <div
                className={`absolute top-[20%] right-[18%] w-[22%] h-[55%] rounded-xl border-2 transition-all ${
                  activeSpeaker === 'Speaker B'
                    ? 'border-cyan-400 bg-cyan-500/15 shadow-lg shadow-cyan-500/20 ring-2 ring-cyan-400/50'
                    : 'border-slate-500/50 bg-black/20'
                }`}
              >
                <div className="absolute -top-6 left-0 px-2 py-0.5 rounded bg-cyan-500 text-[10px] font-bold text-black flex items-center gap-1">
                  <span>Person B (Speaking)</span>
                </div>
              </div>

              {/* Dynamic 9:16 Viewport Cut Window */}
              <div
                className="absolute top-0 bottom-0 w-[31%] border-2 border-dashed border-purple-400 bg-purple-500/10 pointer-events-none transition-all duration-500"
                style={{ left: cropOffset }}
              >
                <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-purple-600 text-[9px] font-bold text-white">
                  9:16 Shorts Crop
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
              <span>Active Subject: <strong className="text-white">{activeSpeaker}</strong></span>
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="flex items-center gap-1 text-purple-300 font-semibold hover:text-purple-200 cursor-pointer"
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                <span>{isPlaying ? 'Pause Simulation' : 'Play Simulation'}</span>
              </button>
            </div>
          </div>

          {/* Right: Output 9:16 Vertical Preview (5 cols) */}
          <div className="md:col-span-5 space-y-2 flex flex-col items-center">
            <div className="w-full text-xs font-bold text-slate-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Smartphone className="w-4 h-4 text-emerald-400" />
                Rendered 9:16 Shorts Output
              </span>
              <span className="text-[10px] text-emerald-400 font-mono">1080x1920</span>
            </div>

            {/* Vertical phone container */}
            <div className="w-48 aspect-[9/16] rounded-2xl overflow-hidden bg-black border-2 border-purple-500/50 relative shadow-xl">
              <img
                src={clip.thumbnailUrl}
                alt="9:16 Preview"
                className="w-full h-full object-cover transition-all duration-500"
                style={{
                  objectPosition: activeSpeaker === 'Speaker A' ? '28% center' : '72% center',
                  transform: 'scale(1.35)',
                }}
              />

              {/* Burned in Subtitle simulation */}
              <div className="absolute bottom-10 left-3 right-3 text-center">
                <span className="px-2 py-1 rounded bg-black/80 text-white font-extrabold text-[11px] shadow-lg border border-white/10">
                  {activeSpeaker === 'Speaker A'
                    ? 'Banyak orang masih belum tahu rahasia ini...'
                    : 'Betul banget! Ketika penonton scroll...'}
                </span>
              </div>

              {/* Watermark badge */}
              <div className="absolute top-3 left-3 text-[9px] font-bold text-white/60 bg-black/40 px-1.5 py-0.5 rounded">
                ClipForge
              </div>
            </div>
          </div>
        </div>

        {/* Speaker Timeline Cut Points */}
        <div className="mb-6 p-4 rounded-2xl bg-black/40 border border-white/10">
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5">
            Timeline Speaker Transitions ({speakerCuts.length} camera cuts)
          </h4>
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {speakerCuts.map((cut, idx) => (
              <button
                key={idx}
                onClick={() => setActiveSpeaker(cut.speaker === 'Speaker B' ? 'Speaker B' : 'Speaker A')}
                className={`p-2.5 rounded-xl border text-xs shrink-0 text-left transition-all cursor-pointer ${
                  activeSpeaker === (cut.speaker === 'Speaker B' ? 'Speaker B' : 'Speaker A')
                    ? 'bg-purple-500/20 border-purple-500 text-purple-200'
                    : 'bg-slate-900/60 border-white/5 text-slate-400 hover:text-white'
                }`}
              >
                <div className="font-bold flex items-center gap-1.5">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      cut.speaker === 'Speaker A' ? 'bg-emerald-400' : 'bg-cyan-400'
                    }`}
                  />
                  <span>{cut.speaker}</span>
                </div>
                <div className="text-[10px] font-mono text-slate-400">At {cut.timestamp}s</div>
              </button>
            ))}
          </div>
        </div>

        {/* Reframe Mode Selection */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          {[
            {
              id: 'speaker',
              label: 'Active Speaker Tracking',
              desc: 'Cuts camera between Person A & Person B automatically',
            },
            {
              id: 'split-stack',
              label: 'Split Screen (2-Stack)',
              desc: 'Places Person A on top and Person B on bottom',
            },
            {
              id: 'center',
              label: 'Centroid Focus',
              desc: 'Smooth weighted pan between all detected subjects',
            },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setMode(item.id as any)}
              className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                mode === item.id
                  ? 'bg-purple-600/20 border-purple-500 text-white'
                  : 'bg-black/30 border-white/5 text-slate-400 hover:border-white/20'
              }`}
            >
              <div className="font-bold text-xs mb-1 flex items-center justify-between">
                <span>{item.label}</span>
                {mode === item.id && <Check className="w-3.5 h-3.5 text-purple-400" />}
              </div>
              <p className="text-[11px] text-slate-400 leading-tight">{item.desc}</p>
            </button>
          ))}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 text-xs font-semibold text-slate-300 transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white text-xs font-bold shadow-lg shadow-purple-500/25 transition-all flex items-center gap-2 cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            <span>Apply Smart Reframe to Timeline</span>
          </button>
        </div>
      </div>
    </div>
  );
};
