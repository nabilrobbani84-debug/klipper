import React, { useState, useRef, useEffect } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Scissors,
  Split,
  Trash2,
  Undo2,
  Redo2,
  Volume2,
  VolumeX,
  Maximize2,
  Smartphone,
  Sparkles,
  Subtitles,
  Music,
  Layers,
  Sliders,
  Type,
  Eye,
  EyeOff,
  Download,
  Share2,
  Shield,
  Film,
  FolderOpen,
  LayoutTemplate,
  Wand2,
  Image as ImageIcon,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  Zap,
} from 'lucide-react';
import {
  ClipCandidate,
  AspectRatio,
  CaptionPreset,
  CaptionConfig,
  ReframingMode,
  TranscriptSentence,
  BRollItem,
  BrandKit,
} from '../types';

interface VideoStudioProps {
  clip: ClipCandidate;
  allClips: ClipCandidate[];
  onSelectClip: (clip: ClipCandidate) => void;
  onUpdateClip: (updated: ClipCandidate) => void;
  onExport: (clip: ClipCandidate) => void;
  onOpenSocial: (clip: ClipCandidate) => void;
  onBackToClips: () => void;
}

type StudioTab =
  | 'captions'
  | 'reframing'
  | 'broll'
  | 'audio'
  | 'brand'
  | 'aitools'
  | 'templates'
  | 'clips';

export const VideoStudio: React.FC<VideoStudioProps> = ({
  clip,
  allClips,
  onSelectClip,
  onUpdateClip,
  onExport,
  onOpenSocial,
  onBackToClips,
}) => {
  const [activeTab, setActiveTab] = useState<StudioTab>('captions');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(clip.startTime);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [volume, setVolume] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [showSafeZones, setShowSafeZones] = useState(true);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [selectedTrack, setSelectedTrack] = useState<'video' | 'caption' | 'broll' | 'audio'>('video');
  const [aiStatusMessage, setAiStatusMessage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Sync video element time
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.currentTime = clip.startTime;
      setCurrentTime(clip.startTime);
    }
  }, [clip.id]);

  // Video time update event
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const now = videoRef.current.currentTime;
      setCurrentTime(now);

      // Loop back if passed clip end time
      if (now >= clip.endTime) {
        videoRef.current.currentTime = clip.startTime;
        setCurrentTime(clip.startTime);
      }
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch((err) => {
        console.warn('Playback play request was prevented:', err);
        setIsPlaying(false);
      });
    }
  };

  const handleSeek = (newTime: number) => {
    if (videoRef.current) {
      const bounded = Math.max(clip.startTime, Math.min(clip.endTime, newTime));
      videoRef.current.currentTime = bounded;
      setCurrentTime(bounded);
    }
  };

  // Keyboard shortcuts handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'KeyS') {
        e.preventDefault();
        triggerSplitAtPlayhead();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        handleSeek(currentTime - 2);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        handleSeek(currentTime + 2);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentTime, isPlaying]);

  // AI Tool Actions
  const runAiTool = (toolName: string, message: string) => {
    setAiStatusMessage(`Running ${toolName}...`);
    setTimeout(() => {
      setAiStatusMessage(`✓ ${message}`);
      setTimeout(() => setAiStatusMessage(null), 3000);
    }, 900);
  };

  const triggerSplitAtPlayhead = () => {
    runAiTool('Split Clip', `Split point created at ${currentTime.toFixed(1)}s`);
  };

  // Helper for caption rendering
  const activeSentence = clip.transcript.find(
    (t) => currentTime >= t.start && currentTime <= t.end
  );

  const activeWord = activeSentence?.words?.find(
    (w) => currentTime >= w.start && currentTime <= w.end
  );

  const currentClipRelativeTime = Math.max(0, currentTime - clip.startTime);
  const totalClipDuration = clip.endTime - clip.startTime;

  // Aspect ratio dimension calculation
  const getAspectClass = () => {
    switch (clip.aspectRatio) {
      case '9:16':
        return 'aspect-[9/16] w-[290px] sm:w-[320px] max-h-[580px]';
      case '1:1':
        return 'aspect-square w-[380px] sm:w-[420px] max-h-[480px]';
      case '4:5':
        return 'aspect-[4/5] w-[340px] max-h-[520px]';
      case '16:9':
      default:
        return 'aspect-video w-[540px] max-h-[400px]';
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] bg-[#090A0F] text-slate-200 select-none overflow-hidden">
      {/* Top Studio Action Bar */}
      <div className="h-14 px-4 border-b border-white/10 glass-panel flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBackToClips}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer flex items-center gap-1 text-xs"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="hidden sm:inline">All Clips</span>
          </button>

          <div className="h-5 w-px bg-white/10" />

          <div>
            <h2 className="text-sm font-bold text-white truncate max-w-[200px] sm:max-w-md">
              {clip.title}
            </h2>
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <span className="font-mono text-purple-300">{clip.aspectRatio}</span>
              <span>•</span>
              <span className="text-emerald-400 font-mono font-bold">Score {clip.score}</span>
              <span>•</span>
              <span>{clip.duration}s</span>
            </div>
          </div>
        </div>

        {/* AI Quick Status Notification */}
        {aiStatusMessage && (
          <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/20 text-purple-200 text-xs border border-purple-500/30 animate-pulse">
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <span>{aiStatusMessage}</span>
          </div>
        )}

        {/* Studio Top Right Actions */}
        <div className="flex items-center gap-2">
          {/* Social Metadata Generator */}
          <button
            onClick={() => onOpenSocial(clip)}
            className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Share2 className="w-3.5 h-3.5 text-pink-400" />
            <span className="hidden sm:inline">Social Metadata</span>
          </button>

          {/* Export Video */}
          <button
            onClick={() => onExport(clip)}
            className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-purple-600/30 flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Clip</span>
          </button>
        </div>
      </div>

      {/* Main Studio Body: Left Sidebar + Center Canvas */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT TOOLBAR ICONS */}
        <div className="w-16 border-r border-white/10 bg-[#0c0e17] flex flex-col items-center py-3 gap-2 shrink-0">
          {[
            { id: 'captions' as StudioTab, label: 'Captions', icon: Subtitles },
            { id: 'reframing' as StudioTab, label: 'Reframe', icon: Smartphone },
            { id: 'templates' as StudioTab, label: 'Templates', icon: LayoutTemplate },
            { id: 'broll' as StudioTab, label: 'AI B-Roll', icon: ImageIcon },
            { id: 'audio' as StudioTab, label: 'Audio', icon: Music },
            { id: 'brand' as StudioTab, label: 'Brand Kit', icon: Shield },
            { id: 'aitools' as StudioTab, label: 'AI Tools', icon: Wand2 },
            { id: 'clips' as StudioTab, label: 'Clips', icon: Layers },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                  isActive
                    ? 'bg-purple-600/30 text-purple-200 border border-purple-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
                title={tab.label}
              >
                <Icon className="w-4 h-4" />
                <span className="text-[9px] font-medium tracking-tight">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* LEFT TOOL SETTINGS PANEL */}
        <div className="w-72 sm:w-80 border-r border-white/10 bg-[#0f111c] p-4 overflow-y-auto shrink-0">
          {/* TAB 1: CAPTIONS */}
          {activeTab === 'captions' && (
            <div className="space-y-5">
              <div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <Subtitles className="w-4 h-4 text-purple-400" />
                  Auto Caption Styling
                </h3>
                <p className="text-[11px] text-slate-400">
                  Animated word-by-word karaoke & viral presets
                </p>
              </div>

              {/* Preset Selector */}
              <div>
                <label className="text-[11px] font-bold text-slate-300 block mb-2">
                  Subtitle Style Preset
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'bold-viral', label: 'Bold Viral', color: '#FACC15' },
                    { id: 'clean-podcast', label: 'Clean Podcast', color: '#38BDF8' },
                    { id: 'minimal', label: 'Minimalist', color: '#FFFFFF' },
                    { id: 'karaoke', label: 'Karaoke Pop', color: '#EC4899' },
                    { id: 'modern', label: 'Modern Neon', color: '#10B981' },
                    { id: 'cinema', label: 'Cinema Box', color: '#F59E0B' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      onClick={() =>
                        onUpdateClip({
                          ...clip,
                          captions: {
                            ...clip.captions,
                            preset: p.id as CaptionPreset,
                            highlightColor: p.color,
                          },
                        })
                      }
                      className={`p-2.5 rounded-xl border text-left text-xs font-semibold transition-all ${
                        clip.captions.preset === p.id
                          ? 'bg-purple-600/25 border-purple-400 text-white shadow-sm'
                          : 'bg-white/[0.02] border-white/5 text-slate-400 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: p.color }}
                        />
                        <span>{p.label}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Highlight Color & Font Size */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">
                    Highlight Color
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={clip.captions.highlightColor}
                      onChange={(e) =>
                        onUpdateClip({
                          ...clip,
                          captions: { ...clip.captions, highlightColor: e.target.value },
                        })
                      }
                      className="w-8 h-8 rounded-lg bg-black border border-white/20 cursor-pointer"
                    />
                    <span className="text-xs font-mono text-slate-300">
                      {clip.captions.highlightColor}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">
                    Font Size ({clip.captions.fontSize}px)
                  </label>
                  <input
                    type="range"
                    min="18"
                    max="48"
                    value={clip.captions.fontSize}
                    onChange={(e) =>
                      onUpdateClip({
                        ...clip,
                        captions: { ...clip.captions, fontSize: Number(e.target.value) },
                      })
                    }
                    className="w-full accent-purple-500 cursor-pointer"
                  />
                </div>
              </div>

              {/* Vertical Position */}
              <div>
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-300 mb-1">
                  <span>Vertical Position</span>
                  <span className="font-mono">{clip.captions.positionY}%</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="85"
                  value={clip.captions.positionY}
                  onChange={(e) =>
                    onUpdateClip({
                      ...clip,
                      captions: { ...clip.captions, positionY: Number(e.target.value) },
                    })
                  }
                  className="w-full accent-purple-500 cursor-pointer"
                />
              </div>

              {/* Toggles */}
              <div className="space-y-2 pt-2 border-t border-white/10">
                <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
                  <span>Karaoke Word Pop Animation</span>
                  <input
                    type="checkbox"
                    checked={clip.captions.karaokeEffect}
                    onChange={(e) =>
                      onUpdateClip({
                        ...clip,
                        captions: { ...clip.captions, karaokeEffect: e.target.checked },
                      })
                    }
                    className="rounded accent-purple-600"
                  />
                </label>

                <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
                  <span>UPPERCASE Typography</span>
                  <input
                    type="checkbox"
                    checked={clip.captions.uppercase}
                    onChange={(e) =>
                      onUpdateClip({
                        ...clip,
                        captions: { ...clip.captions, uppercase: e.target.checked },
                      })
                    }
                    className="rounded accent-purple-600"
                  />
                </label>
              </div>

              {/* Live Transcript Sentence Editor */}
              <div className="pt-2 border-t border-white/10">
                <label className="text-[11px] font-bold text-slate-300 block mb-2">
                  Edit Transcript Words
                </label>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {clip.transcript.map((sentence, sIdx) => (
                    <div
                      key={sentence.id}
                      onClick={() => handleSeek(sentence.start)}
                      className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                        currentTime >= sentence.start && currentTime <= sentence.end
                          ? 'bg-purple-600/20 border-purple-400 text-white'
                          : 'bg-black/30 border-white/5 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] text-purple-300 font-mono mb-1">
                        <span>{sentence.start.toFixed(1)}s - {sentence.end.toFixed(1)}s</span>
                        <span>{sentence.speaker}</span>
                      </div>
                      <p className="line-clamp-2">{sentence.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SMART REFRAMING */}
          {activeTab === 'reframing' && (
            <div className="space-y-5">
              <div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <Smartphone className="w-4 h-4 text-cyan-400" />
                  Smart Reframing (16:9 → 9:16)
                </h3>
                <p className="text-[11px] text-slate-400">
                  AI Face & Speaker tracking keeps key subjects centered
                </p>
              </div>

              {/* Mode Selector */}
              <div>
                <label className="text-[11px] font-bold text-slate-300 block mb-2">
                  Tracking Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'face', label: 'Face Tracking', desc: 'Auto lock onto face' },
                    { id: 'speaker', label: 'Speaker Tracking', desc: 'Focus on active voice' },
                    { id: 'center', label: 'Center Crop', desc: 'Static balanced center' },
                    { id: 'manual', label: 'Manual Pan', desc: 'Custom X/Y slider' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      onClick={() =>
                        onUpdateClip({
                          ...clip,
                          reframing: { ...clip.reframing, mode: m.id as ReframingMode },
                        })
                      }
                      className={`p-2 rounded-xl border text-left text-xs transition-all ${
                        clip.reframing.mode === m.id
                          ? 'bg-cyan-600/25 border-cyan-400 text-white shadow-sm'
                          : 'bg-white/[0.02] border-white/5 text-slate-400 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <div className="font-bold">{m.label}</div>
                      <div className="text-[10px] text-slate-400">{m.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Zoom & Pan Controls */}
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-300 mb-1">
                    <span>Focal Zoom</span>
                    <span className="font-mono">{clip.reframing.zoom.toFixed(2)}x</span>
                  </div>
                  <input
                    type="range"
                    min="1.0"
                    max="2.2"
                    step="0.05"
                    value={clip.reframing.zoom}
                    onChange={(e) =>
                      onUpdateClip({
                        ...clip,
                        reframing: { ...clip.reframing, zoom: parseFloat(e.target.value) },
                      })
                    }
                    className="w-full accent-cyan-500 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-300 mb-1">
                    <span>Horizontal Pan (X)</span>
                    <span className="font-mono">{clip.reframing.panX}%</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="90"
                    value={clip.reframing.panX}
                    onChange={(e) =>
                      onUpdateClip({
                        ...clip,
                        reframing: { ...clip.reframing, panX: parseInt(e.target.value) },
                      })
                    }
                    className="w-full accent-cyan-500 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-300 mb-1">
                    <span>Vertical Pan (Y)</span>
                    <span className="font-mono">{clip.reframing.panY}%</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="80"
                    value={clip.reframing.panY}
                    onChange={(e) =>
                      onUpdateClip({
                        ...clip,
                        reframing: { ...clip.reframing, panY: parseInt(e.target.value) },
                      })
                    }
                    className="w-full accent-cyan-500 cursor-pointer"
                  />
                </div>
              </div>

              {/* Aspect Ratio Switch */}
              <div className="pt-2 border-t border-white/10">
                <label className="text-[11px] font-bold text-slate-300 block mb-2">
                  Canvas Aspect Ratio
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['9:16', '1:1', '16:9', '4:5'] as AspectRatio[]).map((ar) => (
                    <button
                      key={ar}
                      onClick={() => onUpdateClip({ ...clip, aspectRatio: ar })}
                      className={`p-2 rounded-xl border text-xs font-bold text-center transition-all ${
                        clip.aspectRatio === ar
                          ? 'bg-cyan-600/30 border-cyan-400 text-white'
                          : 'bg-white/[0.02] border-white/5 text-slate-400 hover:text-white'
                      }`}
                    >
                      {ar}
                    </button>
                  ))}
                </div>
              </div>

              {/* Safe Zones Toggle */}
              <div className="pt-2 border-t border-white/10">
                <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
                  <span>Show TikTok / Reels Safe Zones</span>
                  <input
                    type="checkbox"
                    checked={showSafeZones}
                    onChange={(e) => setShowSafeZones(e.target.checked)}
                    className="rounded accent-cyan-500"
                  />
                </label>
              </div>
            </div>
          )}

          {/* TAB 3: TEMPLATES */}
          {activeTab === 'templates' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <LayoutTemplate className="w-4 h-4 text-amber-400" />
                  Editing Templates
                </h3>
                <p className="text-[11px] text-slate-400">
                  Pre-configured pacing, caption styling & graphics
                </p>
              </div>

              <div className="space-y-2.5">
                {[
                  {
                    name: 'Viral Podcast',
                    style: 'podcast',
                    color: '#38BDF8',
                    desc: 'Clean speaker framing with minimal transitions',
                  },
                  {
                    name: 'Dynamic Retention',
                    style: 'dynamic-mrbeast',
                    color: '#FACC15',
                    desc: 'Fast zoom punches & high-energy keywords',
                  },
                  {
                    name: 'Cinematic Story',
                    style: 'cinematic',
                    color: '#EC4899',
                    desc: 'Letterboxed aesthetics with filmic colors',
                  },
                  {
                    name: 'Business Masterclass',
                    style: 'auto-viral',
                    color: '#10B981',
                    desc: 'Clean graphs and authority captions',
                  },
                  {
                    name: 'Minimalist Clean',
                    style: 'minimal',
                    color: '#FFFFFF',
                    desc: 'Organic cuts with zero clutter',
                  },
                ].map((tmpl, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      onUpdateClip({
                        ...clip,
                        editingPreset: tmpl.style as any,
                        captions: {
                          ...clip.captions,
                          highlightColor: tmpl.color,
                        },
                      });
                      runAiTool('Template Apply', `Applied ${tmpl.name} template!`);
                    }}
                    className="w-full p-3 rounded-2xl bg-black/40 border border-white/5 hover:border-purple-400/40 text-left transition-all group"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-white group-hover:text-purple-300">
                        {tmpl.name}
                      </span>
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: tmpl.color }}
                      />
                    </div>
                    <p className="text-[10px] text-slate-400">{tmpl.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: B-ROLL AI */}
          {activeTab === 'broll' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <ImageIcon className="w-4 h-4 text-emerald-400" />
                  AI Contextual B-Roll
                </h3>
                <p className="text-[11px] text-slate-400">
                  Visual cutaways suggested from speech keywords
                </p>
              </div>

              <div className="space-y-3">
                {clip.bRolls && clip.bRolls.length > 0 ? (
                  clip.bRolls.map((broll) => (
                    <div
                      key={broll.id}
                      className="p-3 rounded-2xl bg-black/40 border border-white/10 flex items-center gap-3"
                    >
                      <img
                        src={broll.previewUrl}
                        alt={broll.title}
                        className="w-16 h-12 rounded-xl object-cover"
                      />
                      <div className="flex-1 min-w-0 text-xs">
                        <div className="font-bold text-white truncate">{broll.title}</div>
                        <div className="text-[10px] text-slate-400">Keyword: {broll.keyword}</div>
                        <div className="text-[10px] text-emerald-400 font-mono">
                          At {broll.startSeconds}s ({broll.durationSeconds}s cutaway)
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-400 italic">No B-rolls inserted yet.</p>
                )}

                <button
                  onClick={() =>
                    runAiTool('AI B-Roll Generator', 'Generated 2 new contextual cutaways!')
                  }
                  className="w-full py-2.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Generate New AI B-Roll</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 5: AUDIO ENHANCEMENT */}
          {activeTab === 'audio' && (
            <div className="space-y-5">
              <div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <Music className="w-4 h-4 text-pink-400" />
                  Audio & Voice Studio
                </h3>
                <p className="text-[11px] text-slate-400">
                  Noise reduction, voice EQ, and background music
                </p>
              </div>

              {/* Audio Presets */}
              <div>
                <label className="text-[11px] font-bold text-slate-300 block mb-2">
                  Voice EQ Preset
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'podcast', label: 'Podcast Voice' },
                    { id: 'studio', label: 'Studio Master' },
                    { id: 'interview', label: 'Interview Clear' },
                    { id: 'cinematic', label: 'Cinematic Depth' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      onClick={() =>
                        onUpdateClip({
                          ...clip,
                          audio: { ...clip.audio, preset: p.id as any },
                        })
                      }
                      className={`p-2 rounded-xl border text-xs font-semibold text-center transition-all ${
                        clip.audio.preset === p.id
                          ? 'bg-pink-600/30 border-pink-400 text-white'
                          : 'bg-white/[0.02] border-white/5 text-slate-400 hover:text-white'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Toggles */}
              <div className="space-y-2.5">
                <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
                  <span>AI Noise Removal</span>
                  <input
                    type="checkbox"
                    checked={clip.audio.noiseReduction}
                    onChange={(e) =>
                      onUpdateClip({
                        ...clip,
                        audio: { ...clip.audio, noiseReduction: e.target.checked },
                      })
                    }
                    className="rounded accent-pink-500"
                  />
                </label>

                <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
                  <span>Vocal Clarity Enhancer</span>
                  <input
                    type="checkbox"
                    checked={clip.audio.voiceEnhance}
                    onChange={(e) =>
                      onUpdateClip({
                        ...clip,
                        audio: { ...clip.audio, voiceEnhance: e.target.checked },
                      })
                    }
                    className="rounded accent-pink-500"
                  />
                </label>

                <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
                  <span>Loudness Normalization (-14 LUFS)</span>
                  <input
                    type="checkbox"
                    checked={clip.audio.loudnessNorm}
                    onChange={(e) =>
                      onUpdateClip({
                        ...clip,
                        audio: { ...clip.audio, loudnessNorm: e.target.checked },
                      })
                    }
                    className="rounded accent-pink-500"
                  />
                </label>

                <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
                  <span>Smart Music Ducking</span>
                  <input
                    type="checkbox"
                    checked={clip.audio.musicDucking}
                    onChange={(e) =>
                      onUpdateClip({
                        ...clip,
                        audio: { ...clip.audio, musicDucking: e.target.checked },
                      })
                    }
                    className="rounded accent-pink-500"
                  />
                </label>
              </div>

              {/* Background Music Volume */}
              <div>
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-300 mb-1">
                  <span>Background Music Volume</span>
                  <span className="font-mono">{clip.audio.bgMusicVolume}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={clip.audio.bgMusicVolume}
                  onChange={(e) =>
                    onUpdateClip({
                      ...clip,
                      audio: { ...clip.audio, bgMusicVolume: Number(e.target.value) },
                    })
                  }
                  className="w-full accent-pink-500 cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* TAB 6: BRAND KIT */}
          {activeTab === 'brand' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-indigo-400" />
                  Creator Brand Kit
                </h3>
                <p className="text-[11px] text-slate-400">
                  Logo watermark, brand color presets & end screens
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">
                    Watermark Text
                  </label>
                  <input
                    type="text"
                    defaultValue="@ClipForgeAI"
                    className="w-full bg-black/40 text-xs px-3 py-2 rounded-xl border border-white/10 text-white"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">
                    Watermark Position
                  </label>
                  <select className="w-full bg-black/40 text-xs px-3 py-2 rounded-xl border border-white/10 text-white">
                    <option value="top-right">Top Right</option>
                    <option value="top-left">Top Left</option>
                    <option value="bottom-right">Bottom Right</option>
                    <option value="bottom-left">Bottom Left</option>
                  </select>
                </div>

                <div className="pt-2 border-t border-white/10 space-y-2">
                  <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
                    <span>Show Watermark on Exports</span>
                    <input type="checkbox" defaultChecked className="rounded accent-indigo-500" />
                  </label>
                  <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
                    <span>Add Animated Outro Card (2s)</span>
                    <input type="checkbox" defaultChecked className="rounded accent-indigo-500" />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* TAB 7: AI MAGIC TOOLS */}
          {activeTab === 'aitools' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <Wand2 className="w-4 h-4 text-purple-400" />
                  1-Click AI Magic Tools
                </h3>
                <p className="text-[11px] text-slate-400">
                  Instantly automate speech trimming and viral polish
                </p>
              </div>

              <div className="space-y-2">
                {[
                  { name: 'Remove Silence (> 0.4s)', desc: 'Cuts 1.2s dead air' },
                  { name: 'Remove Filler Words', desc: 'Eliminates "uh", "um", "like"' },
                  { name: 'Punchy Hook Booster', desc: 'Re-times first 3 seconds for maximum grip' },
                  { name: 'Auto Dynamic Zoom', desc: 'Adds subtle micro-zooms on key points' },
                  { name: 'Voice Loudness Boost', desc: 'Applies studio broadcast compression' },
                ].map((tool, idx) => (
                  <button
                    key={idx}
                    onClick={() => runAiTool(tool.name, `${tool.name} successfully applied!`)}
                    className="w-full p-2.5 rounded-xl bg-black/40 border border-white/5 hover:border-purple-400/40 text-left transition-all flex items-center justify-between group cursor-pointer"
                  >
                    <div>
                      <div className="text-xs font-bold text-white group-hover:text-purple-300">
                        {tool.name}
                      </div>
                      <div className="text-[10px] text-slate-400">{tool.desc}</div>
                    </div>
                    <Zap className="w-3.5 h-3.5 text-purple-400 group-hover:scale-110 transition-transform" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* TAB 8: CLIPS SWITCHER */}
          {activeTab === 'clips' && (
            <div className="space-y-3">
              <div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-purple-400" />
                  Clips in this Project ({allClips.length})
                </h3>
                <p className="text-[11px] text-slate-400">Switch to another candidate clip</p>
              </div>

              <div className="space-y-2">
                {allClips.map((c, i) => (
                  <button
                    key={c.id}
                    onClick={() => onSelectClip(c)}
                    className={`w-full p-2.5 rounded-xl text-left border transition-all ${
                      c.id === clip.id
                        ? 'bg-purple-600/25 border-purple-400 text-white'
                        : 'bg-black/30 border-white/5 text-slate-400 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] font-bold mb-1">
                      <span className="truncate">Clip #{i + 1}: {c.title}</span>
                      <span className="text-emerald-400 font-mono">Score {c.score}</span>
                    </div>
                    <div className="text-[10px] text-slate-400">{c.duration}s • {c.clipStyle}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* CENTER VIDEO PREVIEW CANVAS */}
        <div className="flex-1 flex flex-col items-center justify-center p-4 bg-[#07080D] relative overflow-hidden">
          {/* Top Canvas Toolbar */}
          <div className="w-full max-w-2xl flex items-center justify-between mb-2 px-2 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <span className="text-slate-300 font-semibold">Aspect:</span>
              <span className="px-2 py-0.5 rounded bg-white/5 text-purple-300 font-mono font-bold">
                {clip.aspectRatio}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSafeZones(!showSafeZones)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                  showSafeZones
                    ? 'bg-purple-600/30 text-purple-300 border border-purple-500/40'
                    : 'bg-white/5 text-slate-400'
                }`}
              >
                {showSafeZones ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                <span>Safe Zones</span>
              </button>
            </div>
          </div>

          {/* Video Viewport Frame */}
          <div
            className={`relative rounded-3xl overflow-hidden shadow-2xl bg-black border-2 border-white/10 transition-all duration-200 flex items-center justify-center ${getAspectClass()}`}
          >
            {/* The Actual Video Tag */}
            <video
              ref={videoRef}
              src={clip.videoUrl}
              onTimeUpdate={handleTimeUpdate}
              onEnded={() => setIsPlaying(false)}
              className="w-full h-full object-cover transition-transform duration-200"
              style={{
                transform: `scale(${clip.reframing.zoom}) translate(${(50 - clip.reframing.panX) * 0.4}%, ${(35 - clip.reframing.panY) * 0.4}%)`,
              }}
              playsInline
            />

            {/* LIVE DYNAMIC SUBTITLES OVERLAY */}
            {activeSentence && (
              <div
                className="absolute left-4 right-4 pointer-events-none text-center select-none z-20"
                style={{ top: `${clip.captions.positionY}%` }}
              >
                <div
                  className={`inline-block px-3 py-1.5 rounded-xl font-extrabold tracking-wide drop-shadow-[0_2px_8px_rgba(0,0,0,1)] ${
                    clip.captions.uppercase ? 'uppercase' : ''
                  }`}
                  style={{
                    fontSize: `${clip.captions.fontSize}px`,
                    fontFamily: clip.captions.fontFamily,
                    color: clip.captions.textColor,
                    textShadow: `0 0 4px ${clip.captions.strokeColor}, 2px 2px 8px #000000`,
                    backgroundColor: clip.captions.hasBackground
                      ? clip.captions.backgroundColor
                      : 'transparent',
                  }}
                >
                  {/* Word-by-word karaoke render if words available */}
                  {activeSentence.words && activeSentence.words.length > 0 ? (
                    activeSentence.words.map((w, wIdx) => {
                      const isSpoken = currentTime >= w.start;
                      const isCurrent = currentTime >= w.start && currentTime <= w.end;
                      return (
                        <span
                          key={wIdx}
                          className={`inline-block mx-1 transition-all ${
                            isCurrent && clip.captions.karaokeEffect
                              ? 'animate-word-pop font-black scale-110'
                              : ''
                          }`}
                          style={{
                            color: isCurrent
                              ? clip.captions.highlightColor
                              : isSpoken
                              ? '#FFFFFF'
                              : 'rgba(255,255,255,0.7)',
                          }}
                        >
                          {w.word}
                        </span>
                      );
                    })
                  ) : (
                    <span>{activeSentence.text}</span>
                  )}
                </div>
              </div>
            )}

            {/* TIKTOK / REELS SAFE ZONE OVERLAYS (Guides) */}
            {showSafeZones && clip.aspectRatio === '9:16' && (
              <div className="absolute inset-0 pointer-events-none border border-cyan-500/20 z-10 flex flex-col justify-between p-3">
                {/* Top header safe boundary */}
                <div className="h-10 border-b border-dashed border-cyan-400/30 flex items-center justify-center">
                  <span className="text-[9px] text-cyan-400 font-mono">Top UI Safe Zone</span>
                </div>

                {/* Right side interaction icons preview */}
                <div className="absolute right-2 bottom-16 flex flex-col items-center gap-2 opacity-40">
                  <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-xs">❤️</div>
                  <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-xs">💬</div>
                  <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-xs">🚀</div>
                </div>

                {/* Bottom caption safe boundary */}
                <div className="h-16 border-t border-dashed border-cyan-400/30 flex items-center justify-center">
                  <span className="text-[9px] text-cyan-400 font-mono">Platform Caption Zone</span>
                </div>
              </div>
            )}
          </div>

          {/* Transport Controls Bar */}
          <div className="w-full max-w-2xl mt-4 px-4 py-2.5 rounded-2xl glass-panel border border-white/10 flex items-center justify-between gap-4">
            {/* Play/Pause & Skips */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleSeek(currentTime - 5)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                title="Rewind 5s"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                onClick={togglePlay}
                className="w-10 h-10 rounded-xl bg-purple-600 hover:bg-purple-500 text-white flex items-center justify-center shadow-lg shadow-purple-600/30 transition-all cursor-pointer"
              >
                {isPlaying ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white ml-0.5" />}
              </button>

              <button
                onClick={() => handleSeek(currentTime + 5)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                title="Forward 5s"
              >
                <RotateCw className="w-4 h-4" />
              </button>

              <div className="text-xs font-mono text-slate-300 ml-2">
                <span className="text-white font-bold">
                  {Math.floor(currentClipRelativeTime / 60)}:
                  {Math.floor(currentClipRelativeTime % 60).toString().padStart(2, '0')}
                </span>
                <span className="text-slate-500"> / </span>
                <span>
                  {Math.floor(totalClipDuration / 60)}:
                  {Math.floor(totalClipDuration % 60).toString().padStart(2, '0')}
                </span>
              </div>
            </div>

            {/* Split, Speed & Volume */}
            <div className="flex items-center gap-3">
              <button
                onClick={triggerSplitAtPlayhead}
                className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300 flex items-center gap-1.5 border border-white/10 transition-colors cursor-pointer"
                title="Split clip at playhead (S)"
              >
                <Scissors className="w-3.5 h-3.5 text-purple-400" />
                <span className="hidden sm:inline">Split (S)</span>
              </button>

              {/* Speed Selector */}
              <select
                value={playbackSpeed}
                onChange={(e) => {
                  const spd = parseFloat(e.target.value);
                  setPlaybackSpeed(spd);
                  if (videoRef.current) videoRef.current.playbackRate = spd;
                }}
                className="bg-black/40 text-xs font-mono px-2 py-1 rounded-lg border border-white/10 text-slate-300 focus:outline-none cursor-pointer"
              >
                <option value="0.5">0.5x</option>
                <option value="1">1.0x</option>
                <option value="1.25">1.25x</option>
                <option value="1.5">1.5x</option>
                <option value="2">2.0x</option>
              </select>

              {/* Volume */}
              <button
                onClick={() => {
                  const muted = !isMuted;
                  setIsMuted(muted);
                  if (videoRef.current) videoRef.current.muted = muted;
                }}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* BOTTOM MULTI-TRACK TIMELINE EDITOR */}
      <div className="h-44 sm:h-52 border-t border-white/10 bg-[#0a0c14] flex flex-col shrink-0">
        {/* Timeline Header Bar */}
        <div className="h-9 px-4 border-b border-white/10 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-3">
            <span className="font-bold text-slate-200">Timeline Tracks</span>
            <div className="flex items-center gap-1 text-[11px] font-mono">
              <span className="text-purple-400 font-bold">Space:</span> Play
              <span className="text-slate-600">|</span>
              <span className="text-purple-400 font-bold">S:</span> Split
              <span className="text-slate-600">|</span>
              <span className="text-purple-400 font-bold">← / →:</span> 2s Step
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px]">Zoom</span>
            <input
              type="range"
              min="0.5"
              max="2.5"
              step="0.1"
              value={timelineZoom}
              onChange={(e) => setTimelineZoom(parseFloat(e.target.value))}
              className="w-20 accent-purple-500 cursor-pointer"
            />
          </div>
        </div>

        {/* Tracks Scroller Area */}
        <div
          ref={timelineRef}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = e.clientX - rect.left - 100; // 100px track label width
            const usableWidth = rect.width - 100;
            if (clickX >= 0) {
              const ratio = Math.max(0, Math.min(1, clickX / usableWidth));
              const targetTime = clip.startTime + ratio * totalClipDuration;
              handleSeek(targetTime);
            }
          }}
          className="flex-1 overflow-x-auto p-3 relative cursor-crosshair space-y-2 timeline-track"
        >
          {/* TRACK 1: VIDEO TRACK */}
          <div className="flex items-center gap-2 h-9">
            <div className="w-24 text-[11px] font-bold text-purple-300 flex items-center gap-1.5 shrink-0">
              <Film className="w-3.5 h-3.5" />
              <span>Video</span>
            </div>
            <div className="flex-1 h-full rounded-xl bg-purple-950/70 border border-purple-500/40 relative overflow-hidden flex items-center px-3 shadow-inner">
              <span className="text-[11px] font-semibold text-purple-200 truncate">
                {clip.title} ({clip.duration}s)
              </span>
            </div>
          </div>

          {/* TRACK 2: CAPTIONS TRACK */}
          <div className="flex items-center gap-2 h-8">
            <div className="w-24 text-[11px] font-bold text-pink-300 flex items-center gap-1.5 shrink-0">
              <Subtitles className="w-3.5 h-3.5" />
              <span>Captions</span>
            </div>
            <div className="flex-1 h-full rounded-xl bg-pink-950/60 border border-pink-500/30 relative overflow-hidden flex items-center px-3">
              <div className="flex items-center gap-2 text-[10px] text-pink-200 truncate">
                <span className="px-1.5 py-0.2 rounded bg-pink-500/30 font-bold uppercase">
                  {clip.captions.preset}
                </span>
                <span>{activeSentence?.text || 'Subtitles aligned'}</span>
              </div>
            </div>
          </div>

          {/* TRACK 3: B-ROLL TRACK */}
          <div className="flex items-center gap-2 h-8">
            <div className="w-24 text-[11px] font-bold text-emerald-300 flex items-center gap-1.5 shrink-0">
              <ImageIcon className="w-3.5 h-3.5" />
              <span>B-Roll</span>
            </div>
            <div className="flex-1 h-full rounded-xl bg-emerald-950/50 border border-emerald-500/30 relative overflow-hidden flex items-center px-3">
              <span className="text-[10px] text-emerald-300">
                {clip.bRolls?.length || 0} AI Cutaways Active
              </span>
            </div>
          </div>

          {/* TRACK 4: AUDIO / MUSIC TRACK */}
          <div className="flex items-center gap-2 h-8">
            <div className="w-24 text-[11px] font-bold text-cyan-300 flex items-center gap-1.5 shrink-0">
              <Music className="w-3.5 h-3.5" />
              <span>Audio</span>
            </div>
            <div className="flex-1 h-full rounded-xl bg-cyan-950/50 border border-cyan-500/30 relative overflow-hidden flex items-center px-3">
              <span className="text-[10px] text-cyan-300 font-mono">
                Enhanced Speech + BG Music ({clip.audio.preset})
              </span>
            </div>
          </div>

          {/* DRAGGABLE PLAYHEAD INDICATOR */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none z-30"
            style={{
              left: `${100 + (totalClipDuration > 0 ? (currentClipRelativeTime / totalClipDuration) * 85 : 0)}%`,
            }}
          >
            <div className="w-3 h-3 rounded-full bg-red-500 -ml-1.5 -mt-1 shadow-lg" />
          </div>
        </div>
      </div>
    </div>
  );
};
