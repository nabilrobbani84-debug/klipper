import React from 'react';
import {
  LayoutTemplate,
  Sparkles,
  Play,
  Check,
  Zap,
  ArrowRight,
} from 'lucide-react';
import { EditingPreset, CaptionPreset } from '../types';

interface TemplateItem {
  id: string;
  name: string;
  category: string;
  editingPreset: EditingPreset;
  captionPreset: CaptionPreset;
  color: string;
  desc: string;
  thumbnailUrl: string;
  idealFor: string;
  stats: string;
}

const TEMPLATES: TemplateItem[] = [
  {
    id: 't-podcast',
    name: 'Viral Podcast Studio',
    category: 'Podcast & Interview',
    editingPreset: 'podcast',
    captionPreset: 'clean-podcast',
    color: '#38BDF8',
    desc: 'Clean speaker-focused framing with minimal cuts and elegant subtitles.',
    thumbnailUrl: 'https://images.unsplash.com/photo-1590602847861-f357a9332bbc?w=600&auto=format&fit=crop&q=80',
    idealFor: 'Conversations, talk shows, founder interviews',
    stats: '88% retention rate',
  },
  {
    id: 't-dynamic',
    name: 'MrBeast Dynamic Pacing',
    category: 'High Retention',
    editingPreset: 'dynamic-mrbeast',
    captionPreset: 'bold-viral',
    color: '#FACC15',
    desc: 'Rapid zooms, keyword popups, intense sound design, and micro-cuts.',
    thumbnailUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80',
    idealFor: 'Challenges, viral stories, entertaining revelations',
    stats: 'Top 1% viral potential',
  },
  {
    id: 't-motivational',
    name: 'Motivational Cinema',
    category: 'Inspirational',
    editingPreset: 'cinematic',
    captionPreset: 'karaoke',
    color: '#EC4899',
    desc: 'Rich letterboxing, film color grading, swelling audio, and word-by-word karaoke.',
    thumbnailUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&auto=format&fit=crop&q=80',
    idealFor: 'Speeches, mindset quotes, fitness transformation',
    stats: '94% share rate',
  },
  {
    id: 't-business',
    name: 'Business & SaaS Masterclass',
    category: 'Education & Tech',
    editingPreset: 'auto-viral',
    captionPreset: 'modern',
    color: '#10B981',
    desc: 'Authority tone, chart overlays, clean neon typography, and actionable takeaways.',
    thumbnailUrl: 'https://images.unsplash.com/photo-1551836022-d5d88e9218df?w=600&auto=format&fit=crop&q=80',
    idealFor: 'Startups, case studies, finance lessons, marketing',
    stats: '72% save rate',
  },
  {
    id: 't-gaming',
    name: 'Gaming & High Energy',
    category: 'Gaming & Reaction',
    editingPreset: 'dynamic-mrbeast',
    captionPreset: 'bold-viral',
    color: '#8B5CF6',
    desc: 'Screen tracking, reaction webcam corner, punchy comedic pauses, and sound effects.',
    thumbnailUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600&auto=format&fit=crop&q=80',
    idealFor: 'Stream highlights, clutch plays, reaction videos',
    stats: 'High comment debate',
  },
  {
    id: 't-educational',
    name: 'Science & Curiosity Explainer',
    category: 'Educational',
    editingPreset: 'podcast',
    captionPreset: 'clean-podcast',
    color: '#06B6D4',
    desc: 'Diagram popups, pacing tailored for clarity and cognitive retention.',
    thumbnailUrl: 'https://images.unsplash.com/photo-1507413245164-6160d8298b31?w=600&auto=format&fit=crop&q=80',
    idealFor: 'Physics, biology, trivia, deep questions',
    stats: '85% complete watch rate',
  },
  {
    id: 't-minimal',
    name: 'Minimalist Clean',
    category: 'Vlog & Lifestyle',
    editingPreset: 'minimal',
    captionPreset: 'minimal',
    color: '#E2E8F0',
    desc: 'Natural soundscapes, zero aggressive effects, tasteful clean typography.',
    thumbnailUrl: 'https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?w=600&auto=format&fit=crop&q=80',
    idealFor: 'Personal vlogs, aesthetic routines, slow thoughts',
    stats: 'Authentic connection',
  },
  {
    id: 't-news',
    name: 'Breaking News Style',
    category: 'News & Commentary',
    editingPreset: 'auto-viral',
    captionPreset: 'cinema',
    color: '#EF4444',
    desc: 'Headline ticker banner, lower-third source quotes, urgent cadence.',
    thumbnailUrl: 'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=600&auto=format&fit=crop&q=80',
    idealFor: 'Industry news, tech updates, market shifts',
    stats: 'Urgent CTR',
  },
  {
    id: 't-product',
    name: 'Product Review & Demo',
    category: 'E-commerce',
    editingPreset: 'auto-viral',
    captionPreset: 'modern',
    color: '#F59E0B',
    desc: 'Split-screen feature callouts, star ratings, and friction vs solution hooks.',
    thumbnailUrl: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80',
    idealFor: 'Gear reviews, software walkthroughs, unboxing',
    stats: 'High click-through',
  },
];

interface TemplatesGalleryProps {
  onSelectTemplate: (preset: EditingPreset, captionPreset: CaptionPreset, color: string) => void;
  hasActiveClip: boolean;
  onNavigateLanding: () => void;
}

export const TemplatesGallery: React.FC<TemplatesGalleryProps> = ({
  onSelectTemplate,
  hasActiveClip,
  onNavigateLanding,
}) => {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full">
      {/* Top Header */}
      <div className="pb-6 border-b border-white/10 mb-8">
        <div className="flex items-center gap-2 mb-1">
          <LayoutTemplate className="w-4 h-4 text-purple-400" />
          <span className="text-xs uppercase font-extrabold text-purple-400 tracking-wider">
            Template Library
          </span>
        </div>
        <h1 className="text-3xl font-extrabold text-white">Viral Editing Presets</h1>
        <p className="text-sm text-slate-400">
          Curated styling blueprints crafted for maximum engagement across short-form algorithms
        </p>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {TEMPLATES.map((tmpl) => (
          <div
            key={tmpl.id}
            className="glass-card rounded-3xl border border-white/10 p-5 flex flex-col justify-between hover:border-purple-500/40 transition-all shadow-xl group"
          >
            <div>
              {/* Thumbnail Image */}
              <div className="relative aspect-video rounded-2xl overflow-hidden bg-black/60 border border-white/10 mb-4 shadow-inner">
                <img
                  src={tmpl.thumbnailUrl}
                  alt={tmpl.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-80"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                {/* Category badge */}
                <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-lg bg-black/80 backdrop-blur-sm text-[10px] font-bold text-slate-200 border border-white/10">
                  {tmpl.category}
                </div>

                {/* Color Dot indicator */}
                <div
                  className="absolute top-2.5 right-2.5 w-3 h-3 rounded-full ring-2 ring-black"
                  style={{ backgroundColor: tmpl.color }}
                />

                {/* Subtitle simulation badge */}
                <div className="absolute bottom-2.5 left-2.5 right-2.5 text-center">
                  <span
                    className="inline-block px-2.5 py-0.5 rounded-lg bg-black/80 text-[11px] font-extrabold text-white border border-white/10 uppercase"
                    style={{ color: tmpl.color }}
                  >
                    EXAMPLE CAPTION TEXT
                  </span>
                </div>
              </div>

              <h3 className="text-lg font-bold text-white mb-1 group-hover:text-purple-300 transition-colors">
                {tmpl.name}
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed mb-3">{tmpl.desc}</p>

              <div className="text-[11px] text-slate-500 space-y-1 mb-4">
                <div>
                  <span className="text-slate-400 font-semibold">Best for: </span>
                  {tmpl.idealFor}
                </div>
                <div>
                  <span className="text-emerald-400 font-semibold">Metric: </span>
                  {tmpl.stats}
                </div>
              </div>
            </div>

            {/* Apply button */}
            <button
              onClick={() => {
                if (hasActiveClip) {
                  onSelectTemplate(tmpl.editingPreset, tmpl.captionPreset, tmpl.color);
                } else {
                  onNavigateLanding();
                }
              }}
              className="w-full py-2.5 px-4 rounded-xl bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/40 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer group-hover:bg-purple-600"
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-300" />
              <span>{hasActiveClip ? 'Apply to Current Clip' : 'Use This Template'}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
