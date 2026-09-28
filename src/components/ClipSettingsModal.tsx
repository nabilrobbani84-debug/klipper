import React from 'react';
import {
  Sliders,
  Check,
  X,
  Sparkles,
  Flame,
  Zap,
  Clock,
  Smartphone,
  Target,
  FileQuestion,
} from 'lucide-react';
import {
  ContentGoal,
  HookType,
  ClipStyle,
  EditingPreset,
  AspectRatio,
} from '../types';

interface ClipSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  contentGoal: ContentGoal;
  setContentGoal: (goal: ContentGoal) => void;
  hookType: HookType;
  setHookType: (hook: HookType) => void;
  preferredDuration: number;
  setPreferredDuration: (sec: number) => void;
  aspectRatio: AspectRatio;
  setAspectRatio: (ar: AspectRatio) => void;
  editingPreset: EditingPreset;
  setEditingPreset: (preset: EditingPreset) => void;
  onApplyAndRegenerate: () => void;
}

export const ClipSettingsModal: React.FC<ClipSettingsModalProps> = ({
  isOpen,
  onClose,
  contentGoal,
  setContentGoal,
  hookType,
  setHookType,
  preferredDuration,
  setPreferredDuration,
  aspectRatio,
  setAspectRatio,
  editingPreset,
  setEditingPreset,
  onApplyAndRegenerate,
}) => {
  if (!isOpen) return null;

  const contentGoals: { id: ContentGoal; label: string; desc: string }[] = [
    { id: 'retention', label: 'Maximum Retention', desc: 'Fast cuts, tension pacing, minimal dead air' },
    { id: 'educational', label: 'Educational', desc: 'Clarity, key insight callouts, diagrams' },
    { id: 'entertainment', label: 'Entertainment', desc: 'Punchlines, comedy pauses, high energy' },
    { id: 'storytelling', label: 'Storytelling', desc: 'Narrative arcs, emotional build-up, payoffs' },
    { id: 'lead-gen', label: 'Lead Generation', desc: 'Curiosity gaps with call-to-action hooks' },
    { id: 'personal-branding', label: 'Personal Branding', desc: 'Authority, quote highlights, charisma' },
    { id: 'product-promo', label: 'Product Promotion', desc: 'Friction-solution demos, benefit emphasis' },
  ];

  const hookTypes: { id: HookType; label: string; example: string }[] = [
    { id: 'curiosity', label: 'Curiosity Gap', example: '"Nobody expected what happened next..."' },
    { id: 'bold-statement', label: 'Bold Statement', example: '"If your hook takes > 1.8s, you already failed."' },
    { id: 'question', label: 'Provocative Question', example: '"Why do 90% of creators stay at 200 views?"' },
    { id: 'controversy', label: 'Controversial Debate', example: '"Stop following standard advice on YouTube."' },
    { id: 'story', label: 'Personal Story', example: '"In 2024 I had zero dollars and one idea..."' },
    { id: 'unexpected-fact', label: 'Unexpected Fact', example: '"Your brain treats procrastination as physical danger."' },
    { id: 'emotional', label: 'High Emotion', example: '"The single lesson that saved my life."' },
  ];

  const durations = [15, 30, 45, 60, 90];

  const aspectRatios: { id: AspectRatio; label: string; platforms: string }[] = [
    { id: '9:16', label: '9:16 Vertical', platforms: 'TikTok / Reels / Shorts' },
    { id: '1:1', label: '1:1 Square', platforms: 'Instagram / LinkedIn' },
    { id: '16:9', label: '16:9 Landscape', platforms: 'YouTube Standard / Web' },
    { id: '4:5', label: '4:5 Portrait', platforms: 'Instagram Feed / FB' },
  ];

  const presets: { id: EditingPreset; label: string; desc: string; icon: string }[] = [
    {
      id: 'auto-viral',
      label: 'Auto Viral',
      desc: 'Fast cuts, animated captions, hook emphasis, silence removal, face tracking.',
      icon: '⚡',
    },
    {
      id: 'podcast',
      label: 'Podcast Studio',
      desc: 'Clean cinematic look, speaker-focused framing, subtle subtitles, calm flow.',
      icon: '🎙️',
    },
    {
      id: 'dynamic-mrbeast',
      label: 'Dynamic Retention',
      desc: 'Fast pacing, dynamic zoom, keyword emphasis text, attention-grabbing micro-cuts.',
      icon: '🔥',
    },
    {
      id: 'cinematic',
      label: 'Cinematic',
      desc: 'Smooth transitions, color grading, subtle motion, premium typography.',
      icon: '🎬',
    },
    {
      id: 'minimal',
      label: 'Minimalist',
      desc: 'Clean subtle captions, natural pacing, zero distracting graphics.',
      icon: '✨',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl">
      <div className="max-w-3xl w-full glass-panel rounded-3xl border border-purple-500/30 p-6 sm:p-8 shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-300">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Viral AI Clip Settings</h2>
              <p className="text-xs text-slate-400">
                Configure AI moment detection algorithms, target aspect ratios, and editing styles
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Section 1: Content Goal */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              1. Content Goal & Algorithm Priority
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {contentGoals.map((g) => (
              <button
                key={g.id}
                onClick={() => setContentGoal(g.id)}
                className={`p-3 rounded-xl text-left border transition-all ${
                  contentGoal === g.id
                    ? 'bg-purple-600/20 border-purple-400 text-white shadow-md'
                    : 'bg-white/[0.02] border-white/5 text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between font-semibold text-xs mb-1">
                  <span>{g.label}</span>
                  {contentGoal === g.id && <Check className="w-3.5 h-3.5 text-purple-400" />}
                </div>
                <p className="text-[11px] text-slate-400 leading-tight">{g.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Section 2: Hook Type */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <FileQuestion className="w-4 h-4 text-pink-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              2. Hook Archetype Strategy
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {hookTypes.map((h) => (
              <button
                key={h.id}
                onClick={() => setHookType(h.id)}
                className={`p-3 rounded-xl text-left border transition-all ${
                  hookType === h.id
                    ? 'bg-pink-600/20 border-pink-400 text-white shadow-md'
                    : 'bg-white/[0.02] border-white/5 text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between font-semibold text-xs mb-1">
                  <span>{h.label}</span>
                  {hookType === h.id && <Check className="w-3.5 h-3.5 text-pink-400" />}
                </div>
                <p className="text-[11px] text-slate-400 italic font-mono">{h.example}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Section 3: Aspect Ratio & Duration */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
          {/* Aspect Ratio */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Smartphone className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                3. Target Aspect Ratio
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {aspectRatios.map((ar) => (
                <button
                  key={ar.id}
                  onClick={() => setAspectRatio(ar.id)}
                  className={`p-2.5 rounded-xl text-left border transition-all ${
                    aspectRatio === ar.id
                      ? 'bg-cyan-600/20 border-cyan-400 text-white shadow-sm'
                      : 'bg-white/[0.02] border-white/5 text-slate-400 hover:bg-white/5 hover:text-slate-200'
                  }`}
                >
                  <div className="font-bold text-xs">{ar.label}</div>
                  <div className="text-[10px] text-slate-400">{ar.platforms}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Preferred Duration */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                4. Ideal Clip Duration
              </h3>
            </div>
            <div className="flex items-center gap-2">
              {durations.map((sec) => (
                <button
                  key={sec}
                  onClick={() => setPreferredDuration(sec)}
                  className={`flex-1 py-2.5 rounded-xl font-bold text-xs border transition-all text-center ${
                    preferredDuration === sec
                      ? 'bg-amber-500/20 border-amber-400 text-amber-200 shadow-sm'
                      : 'bg-white/[0.02] border-white/5 text-slate-400 hover:bg-white/5 hover:text-slate-200'
                  }`}
                >
                  {sec}s
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              AI will align clip boundaries to natural speech sentences near this duration.
            </p>
          </div>
        </div>

        {/* Section 4: AI Editing Preset */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              5. AI Editing Style Preset
            </h3>
          </div>
          <div className="space-y-2">
            {presets.map((p) => (
              <button
                key={p.id}
                onClick={() => setEditingPreset(p.id)}
                className={`w-full p-3 rounded-xl text-left border flex items-center gap-3 transition-all ${
                  editingPreset === p.id
                    ? 'bg-indigo-600/20 border-indigo-400 text-white shadow-sm'
                    : 'bg-white/[0.02] border-white/5 text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`}
              >
                <span className="text-xl">{p.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-xs text-white mb-0.5">{p.label}</div>
                  <div className="text-[11px] text-slate-400">{p.desc}</div>
                </div>
                {editingPreset === p.id && <Check className="w-4 h-4 text-indigo-400 shrink-0" />}
              </button>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onApplyAndRegenerate();
              onClose();
            }}
            className="px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 shadow-lg shadow-purple-600/30 transition-all flex items-center gap-2 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Apply Settings & Re-Analyze</span>
          </button>
        </div>
      </div>
    </div>
  );
};
