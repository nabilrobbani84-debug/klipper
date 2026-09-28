import React, { useState } from 'react';
import {
  Download,
  Trash2,
  Film,
  Archive,
  ExternalLink,
  Clock,
  Sparkles,
  CheckCircle2,
  FileVideo,
} from 'lucide-react';
import { ExportRecord } from '../types';
import { triggerDownload, downloadAllClipsAsZip } from '../services/exportService';

interface DownloadCenterProps {
  exports: ExportRecord[];
  onDeleteExport: (id: string) => void;
  onNavigateLanding: () => void;
}

export const DownloadCenter: React.FC<DownloadCenterProps> = ({
  exports,
  onDeleteExport,
  onNavigateLanding,
}) => {
  const [isZipping, setIsZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState(0);

  const handleDownloadAllZip = async () => {
    if (exports.length === 0) return;
    setIsZipping(true);
    setZipProgress(10);
    try {
      await downloadAllClipsAsZip(exports, (pct) => setZipProgress(pct));
    } catch (err) {
      console.error('ZIP batch export failed', err);
    } finally {
      setIsZipping(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-white/10 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <span className="text-xs uppercase font-extrabold text-emerald-400 tracking-wider">
              Download Center
            </span>
          </div>
          <h1 className="text-3xl font-extrabold text-white">Your Exports</h1>
          <p className="text-sm text-slate-400">
            Rendered high-definition clips ready for TikTok, Instagram Reels, and YouTube Shorts
          </p>
        </div>

        {exports.length > 0 && (
          <button
            onClick={handleDownloadAllZip}
            disabled={isZipping}
            className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-purple-600/25 transition-all cursor-pointer disabled:opacity-50"
          >
            <Archive className="w-4 h-4" />
            <span>
              {isZipping ? `Generating ZIP (${zipProgress}%)...` : `Download All (${exports.length} Clips) as ZIP`}
            </span>
          </button>
        )}
      </div>

      {/* Exports List */}
      {exports.length === 0 ? (
        <div className="text-center py-20 glass-panel rounded-3xl border border-white/10 max-w-xl mx-auto p-8">
          <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 mx-auto mb-4">
            <FileVideo className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">No Exported Clips Yet</h3>
          <p className="text-sm text-slate-400 mb-6">
            Paste a YouTube URL to find viral moments, customize your clips in the editor, and render your first short video.
          </p>
          <button
            onClick={onNavigateLanding}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-purple-600/30 transition-all cursor-pointer"
          >
            Create Your First Clip
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {exports.map((item) => (
            <div
              key={item.id}
              className="glass-card rounded-3xl border border-white/10 p-5 flex flex-col justify-between hover:border-purple-500/40 transition-all shadow-xl"
            >
              <div>
                {/* Thumbnail & Video Preview */}
                <div className="relative aspect-video rounded-2xl overflow-hidden bg-black/60 border border-white/10 mb-4 group shadow-inner">
                  <img
                    src={item.thumbnailUrl}
                    alt={item.clipTitle}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-80"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />

                  {/* Resolution & Format badge */}
                  <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-lg bg-black/80 backdrop-blur-sm text-[10px] font-mono font-bold text-purple-300 border border-purple-500/30">
                    {item.resolution} • {item.format.toUpperCase()}
                  </div>

                  {/* Duration badge */}
                  <div className="absolute bottom-2.5 left-2.5 px-2 py-0.5 rounded-lg bg-black/80 backdrop-blur-sm text-[10px] font-mono text-slate-300 border border-white/10 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-purple-400" />
                    <span>{item.duration}s</span>
                  </div>
                </div>

                <h3 className="text-base font-bold text-white line-clamp-1 mb-1">
                  {item.clipTitle}
                </h3>
                <div className="flex items-center justify-between text-xs text-slate-400 mb-4">
                  <span>{item.sizeMb} MB • {item.fps}fps</span>
                  <span>{item.createdAt}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-3 border-t border-white/10">
                <button
                  onClick={() => {
                    const sanitized = item.clipTitle.replace(/[^a-zA-Z0-9_-]/g, '_');
                    triggerDownload(item.downloadUrl, `${sanitized}_${item.resolution}.${item.format}`);
                  }}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-md shadow-emerald-600/20 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Video</span>
                </button>

                <button
                  onClick={() => onDeleteExport(item.id)}
                  title="Delete from export center"
                  className="p-2.5 rounded-xl bg-white/5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border border-white/10 hover:border-rose-500/30 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
