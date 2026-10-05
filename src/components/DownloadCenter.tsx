import React, { useCallback, useEffect, useState } from 'react';
import { Download, Trash2, Clock, FileVideo, Loader2, RefreshCw } from 'lucide-react';
import { BackendExport, deleteExport, listExports } from '../services/apiClient';

interface DownloadCenterProps {
  onNavigateLanding: () => void;
  onError: (message: string) => void;
}

export const DownloadCenter: React.FC<DownloadCenterProps> = ({ onNavigateLanding, onError }) => {
  const [exports, setExports] = useState<BackendExport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setExports(await listExports());
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not load exports.');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleDelete = async (id: string) => {
    setBusyId(id);
    try {
      await deleteExport(id);
      setExports((prev) => prev.filter((item) => item.id !== id));
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not delete export.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-white/10 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <span className="text-xs uppercase font-extrabold text-emerald-400 tracking-wider">Download center</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white">Your exports</h1>
          <p className="text-sm text-slate-400">Rendered clips, ready for TikTok, Reels and Shorts</p>
        </div>
        <button onClick={() => void refresh()} className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold flex items-center gap-2 cursor-pointer">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-purple-400" /></div>
      ) : exports.length === 0 ? (
        <div className="text-center py-20 glass-panel rounded-3xl border border-white/10 max-w-xl mx-auto p-8">
          <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 mx-auto mb-4"><FileVideo className="w-8 h-8" /></div>
          <h3 className="text-lg font-bold text-white mb-2">No exports yet</h3>
          <p className="text-sm text-slate-400 mb-6">Analyze a video, edit a clip, then export it to render your first short.</p>
          <button onClick={onNavigateLanding} className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs cursor-pointer">Create a clip</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {exports.map((item) => (
            <div key={item.id} className="glass-card rounded-3xl border border-white/10 p-5 flex flex-col justify-between hover:border-purple-500/40 transition-all shadow-xl">
              <div>
                <div className="relative aspect-video rounded-2xl overflow-hidden bg-black/60 border border-white/10 mb-4">
                  {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" className="w-full h-full object-cover opacity-80" /> : <div className="w-full h-full flex items-center justify-center text-slate-600"><FileVideo className="w-8 h-8" /></div>}
                  <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-lg bg-black/80 text-[10px] font-mono font-bold text-purple-300 border border-purple-500/30">
                    {String(item.settings.resolution ?? '')} • {String(item.settings.format ?? 'mp4').toUpperCase()}
                  </div>
                  <div className="absolute bottom-2.5 left-2.5 px-2 py-0.5 rounded-lg bg-black/80 text-[10px] font-mono text-slate-300 border border-white/10 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-purple-400" /><span>{Math.round(Number(item.settings.duration ?? 0))}s</span>
                  </div>
                </div>
                <h3 className="text-base font-bold text-white line-clamp-1 mb-1">{item.clipTitle}</h3>
                <div className="flex items-center justify-between text-xs text-slate-400 mb-4">
                  <span>{(item.sizeBytes / 1_000_000).toFixed(1)} MB</span>
                  <span className="truncate ml-2">{item.projectName}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-3 border-t border-white/10">
                <a href={item.downloadUrl} target="_blank" rel="noopener noreferrer" className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-md shadow-emerald-600/20 cursor-pointer">
                  <Download className="w-3.5 h-3.5" /> Download
                </a>
                <button onClick={() => handleDelete(item.id)} disabled={busyId === item.id} title="Delete export" className="p-2.5 rounded-xl bg-white/5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border border-white/10 hover:border-rose-500/30 transition-colors cursor-pointer disabled:opacity-50">
                  {busyId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
