import React, { useState } from 'react';
import {
  X,
  Copy,
  Check,
  Share2,
  Sparkles,
  Youtube,
  Instagram,
  Facebook,
} from 'lucide-react';
import { ClipCandidate } from '../types';

interface SocialPackModalProps {
  clip: ClipCandidate | null;
  onClose: () => void;
}

export const SocialPackModal: React.FC<SocialPackModalProps> = ({ clip, onClose }) => {
  if (!clip) return null;

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleCopyAll = () => {
    const allText = `=== YOUTUBE SHORTS ===
Title: ${clip.social.youtubeShorts.title}
Description: ${clip.social.youtubeShorts.description}
Tags: ${clip.social.youtubeShorts.hashtags.join(' ')}

=== TIKTOK ===
Caption: ${clip.social.tikTok.caption}
Tags: ${clip.social.tikTok.hashtags.join(' ')}

=== INSTAGRAM REELS ===
Caption: ${clip.social.reels.caption}
Tags: ${clip.social.reels.hashtags.join(' ')}

=== FACEBOOK REELS ===
Caption: ${clip.social.facebookReels.caption}
`;
    navigator.clipboard.writeText(allText);
    setCopiedKey('all');
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl">
      <div className="max-w-2xl w-full glass-panel rounded-3xl border border-purple-500/30 p-6 sm:p-8 shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-pink-500/20 border border-pink-500/30 flex items-center justify-center text-pink-300">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Social Media Publish Kit</h2>
              <p className="text-xs text-slate-400">
                AI-optimized titles, descriptions, and hashtags for maximum algorithm reach
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyAll}
              className="px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
            >
              {copiedKey === 'all' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedKey === 'all' ? 'Copied All!' : 'Copy All'}</span>
            </button>

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Clip Title Banner */}
        <div className="mb-6 p-3 rounded-2xl bg-black/40 border border-white/5 flex items-center justify-between">
          <div className="min-w-0">
            <span className="text-[10px] uppercase font-bold text-purple-400 tracking-wider">
              Selected Clip
            </span>
            <h4 className="text-sm font-bold text-white truncate">{clip.title}</h4>
          </div>
          <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 text-xs font-mono font-bold shrink-0">
            Score {clip.score}
          </span>
        </div>

        <div className="space-y-5">
          {/* 1. YouTube Shorts */}
          <div className="p-4 rounded-2xl bg-black/40 border border-red-500/20">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-xs font-bold text-red-400">
                <Youtube className="w-4 h-4" />
                <span>YouTube Shorts</span>
              </div>
              <button
                onClick={() =>
                  handleCopy(
                    `${clip.social.youtubeShorts.title}\n\n${clip.social.youtubeShorts.description}\n\n${clip.social.youtubeShorts.hashtags.join(' ')}`,
                    'yt'
                  )
                }
                className="text-xs text-slate-300 hover:text-white flex items-center gap-1 px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
              >
                {copiedKey === 'yt' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey === 'yt' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div>
                <span className="text-[10px] text-slate-400 block font-semibold">Title:</span>
                <p className="text-white font-bold">{clip.social.youtubeShorts.title}</p>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-semibold">Description:</span>
                <p className="text-slate-300 whitespace-pre-line">{clip.social.youtubeShorts.description}</p>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {clip.social.youtubeShorts.hashtags.map((tag, i) => (
                  <span key={i} className="text-red-300 font-mono text-[11px]">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* 2. TikTok */}
          <div className="p-4 rounded-2xl bg-black/40 border border-cyan-500/20">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-xs font-bold text-cyan-400">
                <span className="font-extrabold">TikTok</span>
              </div>
              <button
                onClick={() =>
                  handleCopy(
                    `${clip.social.tikTok.caption}\n\n${clip.social.tikTok.hashtags.join(' ')}`,
                    'tt'
                  )
                }
                className="text-xs text-slate-300 hover:text-white flex items-center gap-1 px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
              >
                {copiedKey === 'tt' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey === 'tt' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <p className="text-white font-medium">{clip.social.tikTok.caption}</p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {clip.social.tikTok.hashtags.map((tag, i) => (
                  <span key={i} className="text-cyan-300 font-mono text-[11px]">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* 3. Instagram Reels */}
          <div className="p-4 rounded-2xl bg-black/40 border border-pink-500/20">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-xs font-bold text-pink-400">
                <Instagram className="w-4 h-4" />
                <span>Instagram Reels</span>
              </div>
              <button
                onClick={() =>
                  handleCopy(
                    `${clip.social.reels.caption}\n\n${clip.social.reels.hashtags.join(' ')}`,
                    'ig'
                  )
                }
                className="text-xs text-slate-300 hover:text-white flex items-center gap-1 px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
              >
                {copiedKey === 'ig' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey === 'ig' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <p className="text-white font-medium">{clip.social.reels.caption}</p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {clip.social.reels.hashtags.map((tag, i) => (
                  <span key={i} className="text-pink-300 font-mono text-[11px]">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* 4. Facebook Reels */}
          <div className="p-4 rounded-2xl bg-black/40 border border-blue-500/20">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-xs font-bold text-blue-400">
                <Facebook className="w-4 h-4" />
                <span>Facebook Reels</span>
              </div>
              <button
                onClick={() => handleCopy(clip.social.facebookReels.caption, 'fb')}
                className="text-xs text-slate-300 hover:text-white flex items-center gap-1 px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
              >
                {copiedKey === 'fb' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey === 'fb' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <p className="text-white text-xs">{clip.social.facebookReels.caption}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
