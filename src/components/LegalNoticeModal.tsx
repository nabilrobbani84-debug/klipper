import React from 'react';
import { ShieldCheck, X, AlertTriangle, Scale, Check } from 'lucide-react';

interface LegalNoticeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LegalNoticeModal: React.FC<LegalNoticeModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl">
      <div className="max-w-2xl w-full glass-panel rounded-3xl border border-purple-500/30 p-6 sm:p-8 shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-300">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Legal, Copyright & Fair Use</h2>
              <p className="text-xs text-slate-400">
                Terms of Service & Platform Compliance Standards
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4 text-xs text-slate-300 leading-relaxed">
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-bold text-amber-200 mb-0.5">Creator Ownership & Authorization</h4>
              <p className="text-amber-100/80">
                You must possess all necessary rights, licenses, or fair-use authorizations to process,
                edit, and redistribute content from any YouTube URL submitted to this platform.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="font-bold text-white uppercase tracking-wider text-xs">
              1. No DRM Circumvention or Platform Exploitation
            </h4>
            <p>
              ClipForge AI is an authorized productivity workflow assistant for creators. The system
              does NOT bypass Digital Rights Management (DRM), does not remove third-party watermarks
              without permission, and strictly adheres to platform API guidelines.
            </p>

            <h4 className="font-bold text-white uppercase tracking-wider text-xs">
              2. Fair Use & Transformative Work
            </h4>
            <p>
              Automated reframing, subtitling, and contextual clipping may qualify under Fair Use doctrine
              when transformative, commentary-driven, or educational. However, the legal determination
              remains the sole responsibility of the content publisher.
            </p>

            <h4 className="font-bold text-white uppercase tracking-wider text-xs">
              3. Commercial Distribution Responsibility
            </h4>
            <p>
              When publishing generated shorts to TikTok, Instagram Reels, YouTube Shorts, or Facebook Reels,
              ensure your soundtrack, imagery, and source materials comply with monetization guidelines
              and copyright strikes policies of respective networks.
            </p>
          </div>

          <div className="pt-4 border-t border-white/10 flex justify-end">
            <button
              onClick={onClose}
              className="px-6 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs transition-colors cursor-pointer"
            >
              I Understand & Agree
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
