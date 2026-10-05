import React, { useMemo, useState } from 'react';
import { Camera, Check, Crosshair, Maximize2, Smartphone, User, X } from 'lucide-react';
import { ClipCandidate, ReframingMode } from '../types';

interface SmartReframeModalProps {
  clip: ClipCandidate;
  onClose: () => void;
  onApply: (updatedClip: ClipCandidate) => void;
}

const MODES: Array<{ id: ReframingMode; label: string; description: string; icon: React.ElementType }> = [
  { id: 'face', label: 'Face tracking', description: 'Follow the detected face when rendering', icon: User },
  { id: 'speaker', label: 'Active speaker', description: 'Center on the person speaking (interviews, podcasts)', icon: Camera },
  { id: 'center', label: 'Center crop', description: 'Keep the middle of the frame', icon: Maximize2 },
  { id: 'manual', label: 'Manual', description: 'Set the focus point and zoom yourself', icon: Crosshair },
];

/**
 * Configures how a 16:9 source is reframed to vertical. Face/speaker modes are refined server-side with
 * OpenCV during render; manual mode uses the focus point and zoom chosen here. The preview mirrors the
 * exact crop maths used by the backend (focus point + zoom), so what you see matches the export.
 */
export const SmartReframeModal: React.FC<SmartReframeModalProps> = ({ clip, onClose, onApply }) => {
  const [mode, setMode] = useState<ReframingMode>(clip.reframing.mode === 'object' ? 'manual' : clip.reframing.mode);
  const [panX, setPanX] = useState(clip.reframing.panX);
  const [panY, setPanY] = useState(clip.reframing.panY);
  const [zoom, setZoom] = useState(clip.reframing.zoom);

  const target = clip.aspectRatio === '9:16' ? 9 / 16 : clip.aspectRatio === '1:1' ? 1 : clip.aspectRatio === '4:5' ? 4 / 5 : 16 / 9;
  const isManual = mode === 'manual';

  // Preview crop rectangle over a 16:9 source, matching server computeCrop().
  const preview = useMemo(() => {
    const sourceW = 320;
    const sourceH = 180;
    let w = sourceW;
    let h = sourceH;
    if (sourceW / sourceH > target) w = sourceH * target;
    else h = sourceW / target;
    w = Math.min(sourceW, w / zoom);
    h = Math.min(sourceH, h / zoom);
    const x = Math.min(sourceW - w, Math.max(0, (panX / 100) * sourceW - w / 2));
    const y = Math.min(sourceH - h, Math.max(0, (panY / 100) * sourceH - h / 2));
    return { sourceW, sourceH, w, h, x, y };
  }, [panX, panY, zoom, target]);

  const handleApply = () => {
    onApply({ ...clip, reframing: { ...clip.reframing, mode, panX: Math.round(panX), panY: Math.round(panY), zoom: Number(zoom.toFixed(2)), smoothTracking: true } });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl" role="dialog" aria-modal="true">
      <div className="max-w-3xl w-full glass-panel rounded-3xl border border-purple-500/30 p-6 sm:p-8 shadow-2xl relative max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-300">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Auto reframe</h3>
              <p className="text-xs text-slate-400">Convert 16:9 to {clip.aspectRatio} keeping the subject in frame</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-all cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            {MODES.map((item) => {
              const Icon = item.icon;
              const active = mode === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setMode(item.id)}
                  className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${active ? 'bg-purple-600/20 border-purple-400 text-white' : 'bg-white/[0.02] border-white/10 text-slate-300 hover:border-white/20'}`}
                >
                  <Icon className="w-4 h-4 mt-0.5 text-purple-300" />
                  <span>
                    <span className="block text-sm font-semibold">{item.label}</span>
                    <span className="block text-[11px] text-slate-400">{item.description}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div>
            <div className="relative bg-black rounded-xl overflow-hidden border border-white/10" style={{ aspectRatio: '16 / 9' }}>
              <img src={clip.thumbnailUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-50" />
              <div
                className="absolute border-2 border-purple-400 bg-purple-400/10"
                style={{ left: `${(preview.x / preview.sourceW) * 100}%`, top: `${(preview.y / preview.sourceH) * 100}%`, width: `${(preview.w / preview.sourceW) * 100}%`, height: `${(preview.h / preview.sourceH) * 100}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-2 text-center">Purple box = {clip.aspectRatio} crop applied on export</p>

            <div className={`mt-4 space-y-3 ${isManual ? '' : 'opacity-50 pointer-events-none'}`}>
              <label className="block text-xs font-semibold text-slate-300">
                Horizontal focus <span className="text-slate-500">{Math.round(panX)}%</span>
                <input type="range" min={0} max={100} value={panX} onChange={(e) => setPanX(Number(e.target.value))} className="w-full mt-1 accent-purple-500" />
              </label>
              <label className="block text-xs font-semibold text-slate-300">
                Vertical focus <span className="text-slate-500">{Math.round(panY)}%</span>
                <input type="range" min={0} max={100} value={panY} onChange={(e) => setPanY(Number(e.target.value))} className="w-full mt-1 accent-purple-500" />
              </label>
              <label className="block text-xs font-semibold text-slate-300">
                Zoom <span className="text-slate-500">{zoom.toFixed(2)}x</span>
                <input type="range" min={1} max={2.5} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-full mt-1 accent-purple-500" />
              </label>
            </div>
            {!isManual && <p className="text-[11px] text-slate-400 mt-3">{mode === 'center' ? 'Center crop needs no manual focus.' : 'Focus point is detected automatically during render. Switch to Manual to override.'}</p>}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-5 mt-5 border-t border-white/10">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-colors cursor-pointer">Cancel</button>
          <button onClick={handleApply} className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center gap-2 cursor-pointer">
            <Check className="w-3.5 h-3.5" /> Apply reframe
          </button>
        </div>
      </div>
    </div>
  );
};
