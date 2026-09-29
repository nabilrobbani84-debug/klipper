import React, { useState } from 'react';
import {
  Sparkles,
  Link2,
  ArrowRight,
  Play,
  CheckCircle2,
  Cpu,
  Layers,
  Volume2,
  Subtitles,
  Smartphone,
  TrendingUp,
  Share2,
  Flame,
  Check,
  AlertCircle,
  Clock,
  Eye,
  Sliders,
} from 'lucide-react';
import { YouTubeVideoInfo } from '../types';
import { SAMPLE_VIDEOS } from '../data/sampleVideos';

interface LandingPageProps {
  onStartAnalysis: (url: string) => void;
  onSelectSample: (video: YouTubeVideoInfo) => void;
  isProcessing: boolean;
  onOpenLegal: () => void;
  onOpenSettings: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onStartAnalysis,
  onSelectSample,
  isProcessing,
  onOpenLegal,
  onOpenSettings,
}) => {
  const [inputUrl, setInputUrl] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedSample, setCopiedSample] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const clean = inputUrl.trim();
    if (!clean) {
      setErrorMessage('Please enter a YouTube video URL.');
      return;
    }

    if (!clean.includes('youtube.com') && !clean.includes('youtu.be')) {
      setErrorMessage('Invalid URL format. Please paste a standard YouTube link (e.g. https://www.youtube.com/watch?v=...)');
      return;
    }

    onStartAnalysis(clean);
  };

  const handleQuickSample = (video: YouTubeVideoInfo) => {
    setInputUrl(video.url);
    setErrorMessage(null);
    onSelectSample(video);
  };

  return (
    <div className="relative min-h-[calc(100vh-4rem)] flex flex-col justify-between overflow-hidden">
      {/* Background Decorative Gradient Orbs */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] bg-gradient-to-tr from-purple-600/15 via-indigo-600/10 to-pink-500/10 blur-[140px] pointer-events-none rounded-full -z-10" />
      <div className="absolute top-20 right-10 w-72 h-72 bg-cyan-500/10 blur-[100px] pointer-events-none rounded-full -z-10" />

      {/* Main Container */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-16 w-full">
        {/* Top Announcement Pill */}
        <div className="flex justify-center mb-6">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/25 text-purple-300 text-xs font-medium shadow-inner backdrop-blur-md">
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
            <span>Klipper AI — Gemini Powered Video Intelligence</span>
            <span className="text-purple-400/60">|</span>
            <span className="text-slate-300 flex items-center gap-1">
              Next-Gen Pacing & Auto Captions
            </span>
          </div>
        </div>

        {/* Hero Section */}
        <div className="text-center max-w-4xl mx-auto mb-10">
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-white leading-[1.1] mb-6">
            Turn Any YouTube Video <br className="hidden sm:inline" />
            Into <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-indigo-300 bg-clip-text text-transparent">Viral Short Clips</span>
          </h1>

          <p className="text-base sm:text-lg lg:text-xl text-slate-300 max-w-2xl mx-auto font-normal leading-relaxed">
            Paste a YouTube link. Let AI find the best moments, edit them professionally,
            add captions, and create ready-to-publish short videos.
          </p>
        </div>

        {/* Input Bar Form */}
        <div className="max-w-3xl mx-auto mb-10">
          <form
            onSubmit={handleSubmit}
            className="p-2 sm:p-2.5 rounded-2xl glass-panel glow-purple border border-purple-500/30 shadow-2xl transition-all relative"
          >
            <div className="flex flex-col sm:flex-row items-center gap-2">
              <div className="relative w-full flex items-center">
                <div className="absolute left-4 text-purple-400">
                  <Link2 className="w-5 h-5" />
                </div>
                <input
                  type="text"
                  value={inputUrl}
                  onChange={(e) => {
                    setInputUrl(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="Paste YouTube URL (e.g. https://www.youtube.com/watch?v=...)"
                  className="w-full bg-black/40 text-white placeholder-slate-500 text-sm sm:text-base pl-12 pr-4 py-3.5 rounded-xl border border-white/10 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20 transition-all font-sans"
                />
              </div>

              <button
                type="submit"
                disabled={isProcessing}
                className="w-full sm:w-auto px-7 py-3.5 rounded-xl font-bold text-sm tracking-wide text-white bg-gradient-to-r from-purple-600 via-indigo-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 active:scale-[0.98] transition-all duration-150 shadow-lg shadow-purple-600/30 flex items-center justify-center gap-2 shrink-0 disabled:opacity-50 cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Analyzing...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 fill-white" />
                    <span>Generate Clips</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Error Message */}
          {errorMessage && (
            <div className="mt-3 flex items-center gap-2 text-rose-400 text-xs px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 max-w-xl mx-auto">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Quick Demo Pickers */}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs">
            <span className="text-slate-400 flex items-center gap-1">
              <Play className="w-3 h-3 text-purple-400 fill-purple-400" />
              Try sample video:
            </span>
            {SAMPLE_VIDEOS.map((sample) => (
              <button
                key={sample.id}
                onClick={() => handleQuickSample(sample)}
                className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-purple-500/20 text-slate-300 hover:text-white border border-white/10 hover:border-purple-400/40 transition-all truncate max-w-[210px] cursor-pointer"
                title={sample.title}
              >
                {sample.title.split(':')[0]}
              </button>
            ))}
          </div>
        </div>

        {/* Pipeline Diagram */}
        <div className="max-w-4xl mx-auto mb-16 px-4">
          <div className="bg-black/30 backdrop-blur-md rounded-2xl border border-white/10 p-4 sm:p-6 shadow-xl">
            <p className="text-xs uppercase tracking-wider font-bold text-center text-purple-300/80 mb-4">
              Automated AI Pipeline Workflow
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4 text-xs sm:text-sm font-semibold text-slate-200">
              <div className="px-3 py-2 rounded-xl bg-purple-950/60 border border-purple-500/30 flex items-center gap-2 text-purple-200">
                <Link2 className="w-4 h-4 text-purple-400" />
                <span>YouTube URL</span>
              </div>
              <span className="text-purple-400">→</span>
              <div className="px-3 py-2 rounded-xl bg-indigo-950/60 border border-indigo-500/30 flex items-center gap-2 text-indigo-200">
                <Cpu className="w-4 h-4 text-indigo-400" />
                <span>AI Analysis</span>
              </div>
              <span className="text-purple-400">→</span>
              <div className="px-3 py-2 rounded-xl bg-pink-950/60 border border-pink-500/30 flex items-center gap-2 text-pink-200">
                <Flame className="w-4 h-4 text-pink-400" />
                <span>Best Moments</span>
              </div>
              <span className="text-purple-400">→</span>
              <div className="px-3 py-2 rounded-xl bg-cyan-950/60 border border-cyan-500/30 flex items-center gap-2 text-cyan-200">
                <Sliders className="w-4 h-4 text-cyan-400" />
                <span>Professional Editing</span>
              </div>
              <span className="text-purple-400">→</span>
              <div className="px-3 py-2 rounded-xl bg-emerald-950/60 border border-emerald-500/30 flex items-center gap-2 text-emerald-200">
                <Share2 className="w-4 h-4 text-emerald-400" />
                <span>Ready to Publish</span>
              </div>
            </div>
          </div>
        </div>

        {/* Feature Grid: 6 Core Pillars */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-6xl mx-auto mb-16">
          <div className="glass-card p-6 rounded-2xl transition-all">
            <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 mb-4">
              <Cpu className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">AI-Powered Clipping</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Analyzes transcripts, audio energy, and voice inflection to isolate the highest-retention hooks and punchlines automatically.
            </p>
          </div>

          <div className="glass-card p-6 rounded-2xl transition-all">
            <div className="w-12 h-12 rounded-xl bg-pink-500/10 border border-pink-500/30 flex items-center justify-center text-pink-400 mb-4">
              <Subtitles className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Smart Captions</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Word-by-word animated karaoke subtitles, vibrant viral highlights, customizable fonts, stroke backgrounds, and multi-language support.
            </p>
          </div>

          <div className="glass-card p-6 rounded-2xl transition-all">
            <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 mb-4">
              <Smartphone className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Auto Reframing</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Dynamic face and speaker tracking converts horizontal 16:9 videos into 9:16 vertical shorts without losing the subject.
            </p>
          </div>

          <div className="glass-card p-6 rounded-2xl transition-all">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-4">
              <TrendingUp className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Viral Moment Detection</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Scores every clip by retention potential, curiosity gap, controversy level, and emotional resonance for maximum views.
            </p>
          </div>

          <div className="glass-card p-6 rounded-2xl transition-all">
            <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mb-4">
              <Layers className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Professional Templates</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Pre-built layouts for Viral Podcasts, Fast-paced Dynamic Shorts, Educational Insights, Motivational Speeches, and Business Talks.
            </p>
          </div>

          <div className="glass-card p-6 rounded-2xl transition-all">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-4">
              <Share2 className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Multi-Platform Export</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Generates custom titles, descriptions, and trending hashtags for TikTok, Instagram Reels, YouTube Shorts, and Facebook in one click.
            </p>
          </div>
        </div>

        {/* Live Transformation Demo Showcase */}
        <div className="max-w-5xl mx-auto glass-panel p-6 sm:p-8 rounded-3xl border border-white/10 mb-16">
          <div className="text-center mb-8">
            <span className="text-xs uppercase font-extrabold tracking-widest text-purple-400">
              Live Before & After Demonstration
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white mt-1">
              From 60-Minute Landscape Video to 45-Second Viral Reel
            </h2>
            <p className="text-sm text-slate-400 max-w-xl mx-auto mt-2">
              Watch how our reframing AI tracks the speaker while rendering dynamic word-level captions.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
            {/* 16:9 Raw Source */}
            <div className="md:col-span-6 bg-black/60 rounded-2xl p-4 border border-white/10">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-3">
                <span className="font-semibold text-slate-300">Raw Source (16:9 Landscape)</span>
                <span className="px-2 py-0.5 rounded bg-white/5">00:14 / 48:15</span>
              </div>
              <div className="relative aspect-video rounded-xl overflow-hidden bg-slate-900 border border-white/5 flex items-center justify-center group">
                <img
                  src="https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80"
                  alt="Landscape Raw"
                  className="w-full h-full object-cover opacity-80"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                {/* Simulated tracking box */}
                <div className="absolute w-28 h-36 border-2 border-emerald-400 rounded-lg shadow-lg flex items-start justify-end p-1">
                  <span className="bg-emerald-500 text-[9px] text-black font-extrabold px-1 rounded">
                    SPEAKER 98%
                  </span>
                </div>
                <div className="absolute bottom-3 left-3 text-xs text-slate-300">
                  ⚠️ Dead space on left & right for phone screens
                </div>
              </div>
            </div>

            {/* Transform Arrow Indicator */}
            <div className="hidden md:flex md:col-span-1 justify-center">
              <div className="w-10 h-10 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300">
                <ArrowRight className="w-5 h-5" />
              </div>
            </div>

            {/* 9:16 Vertical Short Output */}
            <div className="md:col-span-5 flex flex-col items-center">
              <div className="w-full text-xs text-slate-400 mb-3 flex items-center justify-between">
                <span className="font-semibold text-purple-300">ClipForge AI Output (9:16 Vertical)</span>
                <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold">Score 96</span>
              </div>
              <div className="relative w-[210px] sm:w-[240px] aspect-[9/16] rounded-2xl overflow-hidden shadow-2xl border-2 border-purple-500/50 bg-black">
                <img
                  src="https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80"
                  alt="Vertical Short"
                  className="w-full h-full object-cover scale-[1.5] origin-center"
                />
                {/* Overlay Vignette */}
                <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/80" />

                {/* Subtitle karaoke overlay */}
                <div className="absolute bottom-16 left-3 right-3 text-center pointer-events-none">
                  <span className="inline-block font-extrabold text-base tracking-wide text-white uppercase drop-shadow-[0_2px_8px_rgba(0,0,0,1)] bg-black/60 px-2.5 py-1 rounded-lg border border-white/10">
                    IF YOUR <span className="text-yellow-400 animate-pulse underline decoration-yellow-400">HOOK</span> TAKES &gt; 1.8s
                  </span>
                </div>

                {/* Platform overlay hints */}
                <div className="absolute right-2 bottom-20 flex flex-col items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-black/40 backdrop-blur-sm border border-white/20 flex items-center justify-center text-[10px]">❤️</div>
                  <div className="w-7 h-7 rounded-full bg-black/40 backdrop-blur-sm border border-white/20 flex items-center justify-center text-[10px]">💬</div>
                  <div className="w-7 h-7 rounded-full bg-black/40 backdrop-blur-sm border border-white/20 flex items-center justify-center text-[10px]">🚀</div>
                </div>

                {/* Sound wave icon */}
                <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-black/60 text-[10px] text-purple-300 font-semibold flex items-center gap-1 border border-white/10">
                  <Volume2 className="w-3 h-3 text-purple-400" />
                  Enhanced
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Legal & Compliance Notice Footer Banner */}
        <div className="max-w-4xl mx-auto text-center text-xs text-slate-500 border-t border-white/5 pt-8">
          <p>
            ClipForge AI is an authorized productivity tool designed for creators and content owners.
            Users are responsible for ensuring appropriate rights, licenses, or fair-use permissions for any video processed.
          </p>
          <div className="mt-2 flex items-center justify-center gap-4">
            <button
              onClick={onOpenLegal}
              className="text-purple-400 hover:text-purple-300 underline underline-offset-2 cursor-pointer"
            >
              Copyright, Fair Use & Platform Compliance Guidelines
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
