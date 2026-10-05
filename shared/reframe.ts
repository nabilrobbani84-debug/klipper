import type { AspectRatio, OutputResolution, ReframingSettings } from './types.js';

export interface Size { width: number; height: number; }
export interface CropRect extends Size { x: number; y: number; }

const SHORT_SIDE: Record<OutputResolution, number> = { '720p': 720, '1080p': 1080, '1440p': 1440, '4K': 2160 };

function even(value: number) {
  return Math.max(2, Math.round(value / 2) * 2);
}

export function aspectRatioValue(aspect: AspectRatio): number {
  const [w, h] = aspect.split(':').map(Number);
  return w / h;
}

/** Output frame size for a target aspect ratio and resolution class (resolution = short side). */
export function outputSize(aspect: AspectRatio, resolution: OutputResolution): Size {
  const short = SHORT_SIDE[resolution];
  const ratio = aspectRatioValue(aspect);
  return ratio >= 1 ? { width: even(short * ratio), height: even(short) } : { width: even(short), height: even(short / ratio) };
}

/**
 * Computes the source crop rectangle for a target aspect ratio. panX/panY (0-100) set the focus point,
 * zoom (>=1) tightens the crop. The rectangle is always clamped inside the source frame.
 */
export function computeCrop(source: Size, aspect: AspectRatio, reframing: Pick<ReframingSettings, 'panX' | 'panY' | 'zoom'>): CropRect {
  const ratio = aspectRatioValue(aspect);
  const zoom = Math.min(3, Math.max(1, reframing.zoom || 1));
  let width = source.width;
  let height = source.height;
  if (source.width / source.height > ratio) width = source.height * ratio;
  else height = source.width / ratio;
  width = Math.min(source.width, even(width / zoom));
  height = Math.min(source.height, even(height / zoom));
  const focusX = (Math.min(100, Math.max(0, reframing.panX)) / 100) * source.width;
  const focusY = (Math.min(100, Math.max(0, reframing.panY)) / 100) * source.height;
  const x = Math.round(Math.min(source.width - width, Math.max(0, focusX - width / 2)));
  const y = Math.round(Math.min(source.height - height, Math.max(0, focusY - height / 2)));
  return { width, height, x, y };
}
