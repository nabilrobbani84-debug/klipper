import React, { useState } from 'react';
import {
  X,
  Check,
  Zap,
  Shield,
  Sparkles,
  Clock,
  Layers,
  HardDrive,
  CreditCard,
  User,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { UserAccount } from '../types';

interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserAccount;
  onUpdatePlan: (plan: 'free' | 'creator' | 'pro') => void;
}

export const SubscriptionModal: React.FC<SubscriptionModalProps> = ({
  isOpen,
  onClose,
  user,
  onUpdatePlan,
}) => {
  if (!isOpen) return null;

  const [activeSubTab, setActiveSubTab] = useState<'plans' | 'usage'>('plans');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const plans = [
    {
      id: 'free' as const,
      name: 'Free Starter',
      price: '$0',
      period: 'forever',
      desc: 'For hobbyists testing the power of AI short-form clipping.',
      features: [
        '30 processing minutes / month',
        '720p / 1080p standard export',
        'Basic AI moment detection',
        'Subtle ClipForge watermark',
        'Community support',
      ],
      popular: false,
      buttonText: user.plan === 'free' ? 'Current Plan' : 'Downgrade to Free',
    },
    {
      id: 'creator' as const,
      name: 'Creator Studio',
      price: '$29',
      period: 'per month',
      desc: 'For growing creators, YouTubers & agencies publishing daily.',
      features: [
        '180 processing minutes / month',
        '1080p 60fps & 1440p exports',
        'Zero watermark on all videos',
        'Advanced word-by-word karaoke captions',
        'Smart Face & Speaker Auto-Reframing',
        'Automatic Silence & Filler word removal',
        'AI Contextual B-Roll suggestions',
      ],
      popular: true,
      buttonText: user.plan === 'creator' ? 'Current Plan' : 'Upgrade to Creator',
    },
    {
      id: 'pro' as const,
      name: 'Pro Agency',
      price: '$59',
      period: 'per month',
      desc: 'For high-volume media brands and multi-channel production teams.',
      features: [
        '600 processing minutes / month',
        'Cinema 4K Ultra HD exports (H.265)',
        'Custom Brand Kit & Watermark replacement',
        'Priority GPU worker processing queue',
        'Bulk ZIP download for 50+ clips',
        'Unlimited social metadata exports',
        'Dedicated VIP support',
      ],
      popular: false,
      buttonText: user.plan === 'pro' ? 'Current Plan' : 'Upgrade to Pro',
    },
  ];

  const handleSelectPlan = (planId: 'free' | 'creator' | 'pro') => {
    onUpdatePlan(planId);
    setSuccessMessage(`Successfully switched to ${planId.toUpperCase()} plan!`);

    confetti({
      particleCount: 50,
      spread: 60,
      origin: { y: 0.5 },
    });

    setTimeout(() => {
      setSuccessMessage(null);
    }, 2500);
  };

  const minutesPercent = Math.min(100, Math.round((user.minutesUsed / user.minutesLimit) * 100));
  const storagePercent = Math.min(100, Math.round((user.storageMbUsed / user.storageMbLimit) * 100));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl">
      <div className="max-w-4xl w-full glass-panel rounded-3xl border border-purple-500/30 p-6 sm:p-8 shadow-2xl max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-300">
              <Zap className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Account & Subscription</h2>
              <p className="text-xs text-slate-400">
                Manage your plan tier, usage credits, and billing preferences
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex bg-white/5 p-1 rounded-xl border border-white/10 text-xs">
              <button
                onClick={() => setActiveSubTab('plans')}
                className={`px-3 py-1 rounded-lg font-semibold transition-all ${
                  activeSubTab === 'plans'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Plans
              </button>
              <button
                onClick={() => setActiveSubTab('usage')}
                className={`px-3 py-1 rounded-lg font-semibold transition-all ${
                  activeSubTab === 'usage'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Usage Stats
              </button>
            </div>

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Success Alert */}
        {successMessage && (
          <div className="mb-6 p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2">
            <Check className="w-4 h-4" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* TAB 1: PLANS */}
        {activeSubTab === 'plans' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {plans.map((p) => {
              const isCurrent = user.plan === p.id;
              return (
                <div
                  key={p.id}
                  className={`rounded-3xl p-6 border flex flex-col justify-between transition-all relative ${
                    p.popular
                      ? 'bg-gradient-to-b from-purple-950/40 to-black/60 border-purple-500/60 shadow-xl shadow-purple-500/10'
                      : 'bg-black/40 border-white/10 hover:border-white/20'
                  }`}
                >
                  {p.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-md">
                      Most Popular
                    </div>
                  )}

                  <div>
                    <h3 className="text-lg font-bold text-white mb-1">{p.name}</h3>
                    <p className="text-xs text-slate-400 min-h-[32px] mb-4">{p.desc}</p>

                    <div className="flex items-baseline gap-1 mb-6">
                      <span className="text-3xl font-extrabold text-white">{p.price}</span>
                      <span className="text-xs text-slate-400 font-mono">/ {p.period}</span>
                    </div>

                    <div className="space-y-2.5 mb-6 text-xs text-slate-300">
                      {p.features.map((feat, fIdx) => (
                        <div key={fIdx} className="flex items-start gap-2">
                          <Check className="w-3.5 h-3.5 text-purple-400 shrink-0 mt-0.5" />
                          <span>{feat}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => handleSelectPlan(p.id)}
                    disabled={isCurrent}
                    className={`w-full py-2.5 rounded-xl font-bold text-xs transition-all cursor-pointer ${
                      isCurrent
                        ? 'bg-white/10 text-slate-400 cursor-default'
                        : p.popular
                        ? 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-lg shadow-purple-600/30'
                        : 'bg-white/10 hover:bg-white/20 text-white'
                    }`}
                  >
                    {p.buttonText}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* TAB 2: USAGE STATS */}
        {activeSubTab === 'usage' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Meter 1: Minutes */}
              <div className="p-5 rounded-2xl bg-black/40 border border-white/10">
                <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                  <span className="flex items-center gap-1.5 font-bold text-white">
                    <Clock className="w-4 h-4 text-purple-400" />
                    Minutes Processed
                  </span>
                  <span className="font-mono text-purple-300">
                    {user.minutesUsed} / {user.minutesLimit}m
                  </span>
                </div>
                <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-500 rounded-full"
                    style={{ width: `${minutesPercent}%` }}
                  />
                </div>
                <span className="text-[10px] text-slate-500 mt-2 block">
                  Resets in 18 days
                </span>
              </div>

              {/* Meter 2: Clips Generated */}
              <div className="p-5 rounded-2xl bg-black/40 border border-white/10">
                <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                  <span className="flex items-center gap-1.5 font-bold text-white">
                    <Layers className="w-4 h-4 text-pink-400" />
                    Clips Created
                  </span>
                  <span className="font-mono text-pink-300 font-bold">
                    {user.clipsGenerated} clips
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  Lifetime clips generated across all YouTube projects.
                </p>
              </div>

              {/* Meter 3: Storage */}
              <div className="p-5 rounded-2xl bg-black/40 border border-white/10">
                <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                  <span className="flex items-center gap-1.5 font-bold text-white">
                    <HardDrive className="w-4 h-4 text-cyan-400" />
                    Cloud Storage
                  </span>
                  <span className="font-mono text-cyan-300">
                    {user.storageMbUsed} / {user.storageMbLimit} MB
                  </span>
                </div>
                <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-cyan-500 rounded-full"
                    style={{ width: `${storagePercent}%` }}
                  />
                </div>
                <span className="text-[10px] text-slate-500 mt-2 block">
                  High-speed CDN object storage
                </span>
              </div>
            </div>

            {/* Profile Info */}
            <div className="p-5 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <img
                  src={user.avatarUrl}
                  alt={user.name}
                  className="w-12 h-12 rounded-full object-cover ring-2 ring-purple-500/40"
                />
                <div>
                  <h4 className="text-sm font-bold text-white">{user.name}</h4>
                  <p className="text-xs text-slate-400">{user.email}</p>
                </div>
              </div>

              <div className="text-right">
                <span className="px-3 py-1 rounded-xl bg-purple-500/20 text-purple-300 border border-purple-500/30 text-xs font-bold uppercase">
                  {user.plan} Tier
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
