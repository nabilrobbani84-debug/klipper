import type { CaptionSettings, TranscriptDocument, TranscriptWord } from '../types.js';

export const DEFAULT_CAPTION_SETTINGS: CaptionSettings = {
  enabled: true,
  preset: 'bold-viral',
  fontFamily: 'DejaVu Sans',
  fontSize: 28,
  textColor: '#FFFFFF',
  highlightColor: '#FACC15',
  strokeColor: '#000000',
  strokeWidth: 4,
  backgroundColor: 'rgba(0,0,0,0.6)',
  hasBackground: false,
  positionY: 72,
  uppercase: true,
  karaokeEffect: true,
  maxWordsPerLine: 4,
};

/** Reference preview height the editor uses for font sizes; output sizes scale from this. */
const PREVIEW_HEIGHT = 640;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Converts #RGB/#RRGGBB/rgba() into an ASS colour (&HAABBGGRR, where AA=00 is opaque). */
export function toAssColor(input: string, fallback = '&H00FFFFFF'): string {
  const value = input.trim();
  let r: number; let g: number; let b: number; let alpha = 1;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value);
  if (hex) {
    const full = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    r = parseInt(full.slice(0, 2), 16); g = parseInt(full.slice(2, 4), 16); b = parseInt(full.slice(4, 6), 16);
  } else if (rgba) {
    r = Number(rgba[1]); g = Number(rgba[2]); b = Number(rgba[3]); alpha = rgba[4] === undefined ? 1 : clamp(Number(rgba[4]), 0, 1);
  } else {
    return fallback;
  }
  const hex2 = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0').toUpperCase();
  return `&H${hex2((1 - alpha) * 255)}${hex2(b)}${hex2(g)}${hex2(r)}`;
}

export function formatAssTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const totalCentis = Math.round(safe * 100);
  const h = Math.floor(totalCentis / 360000);
  const m = Math.floor((totalCentis % 360000) / 6000);
  const s = Math.floor((totalCentis % 6000) / 100);
  const cs = totalCentis % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function escapeAss(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\n/g, ' ');
}

/** Words inside the clip window, re-timed relative to the clip start. Segments without word timings are split evenly. */
export function clipWords(transcript: TranscriptDocument, start: number, end: number): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  for (const segment of transcript.segments) {
    if (segment.end <= start || segment.start >= end) continue;
    const source = segment.words.length > 0
      ? segment.words
      : (() => {
        const tokens = segment.text.split(/\s+/).filter(Boolean);
        const step = (segment.end - segment.start) / Math.max(1, tokens.length);
        return tokens.map((word, index) => ({ word, start: segment.start + index * step, end: segment.start + (index + 1) * step }));
      })();
    for (const word of source) {
      if (word.end <= start || word.start >= end) continue;
      words.push({ word: word.word, start: Math.max(0, word.start - start), end: Math.min(end, word.end) - start });
    }
  }
  return words.sort((a, b) => a.start - b.start);
}

/** Groups words into short caption lines, breaking on punctuation, long pauses and maxWordsPerLine. */
export function groupWords(words: TranscriptWord[], maxWordsPerLine: number): TranscriptWord[][] {
  const groups: TranscriptWord[][] = [];
  let current: TranscriptWord[] = [];
  const limit = clamp(Math.round(maxWordsPerLine), 1, 12);
  words.forEach((word, index) => {
    const previous = words[index - 1];
    if (current.length > 0 && (current.length >= limit || (previous && word.start - previous.end > 0.8))) {
      groups.push(current);
      current = [];
    }
    current.push(word);
    if (/[.!?]$/.test(word.word)) {
      groups.push(current);
      current = [];
    }
  });
  if (current.length > 0) groups.push(current);
  return groups;
}

export interface AssOptions {
  width: number;
  height: number;
  fontFamily?: string;
}

/** Builds an Advanced SubStation Alpha subtitle file with optional per-word (karaoke) highlighting. */
export function buildAssSubtitles(transcript: TranscriptDocument, clip: { start: number; end: number }, settings: CaptionSettings, options: AssOptions): string {
  const scale = options.height / PREVIEW_HEIGHT;
  const fontSize = Math.round(clamp(settings.fontSize, 10, 120) * scale);
  const outline = Math.round(clamp(settings.strokeWidth, 0, 20) * scale * 0.6 * 10) / 10;
  const primary = toAssColor(settings.textColor);
  const highlight = toAssColor(settings.highlightColor, '&H0015CCFA');
  const outlineColor = toAssColor(settings.strokeColor, '&H00000000');
  const back = toAssColor(settings.backgroundColor, '&H64000000');
  const borderStyle = settings.hasBackground ? 3 : 1;
  const x = Math.round(options.width / 2);
  const y = Math.round((options.height * clamp(settings.positionY, 8, 92)) / 100);
  const font = (options.fontFamily ?? settings.fontFamily).replace(/[,\n]/g, ' ');

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${options.width}`,
    `PlayResY: ${options.height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Caption,${font},${fontSize},${primary},${highlight},${outlineColor},${back},-1,0,0,0,100,100,0,0,${borderStyle},${outline},${settings.hasBackground ? 0 : Math.max(1, Math.round(scale))},5,${Math.round(options.width * 0.06)},${Math.round(options.width * 0.06)},0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const duration = clip.end - clip.start;
  const words = clipWords(transcript, clip.start, clip.end);
  const groups = groupWords(words, settings.maxWordsPerLine);
  const transform = (word: string) => escapeAss(settings.uppercase ? word.toUpperCase() : word);
  const events: string[] = [];

  groups.forEach((group, groupIndex) => {
    const nextGroup = groups[groupIndex + 1];
    const groupEnd = Math.min(duration, Math.max(group[group.length - 1].end, nextGroup ? Math.min(nextGroup[0].start, group[group.length - 1].end + 0.6) : group[group.length - 1].end + 0.4));
    const position = `{\\pos(${x},${y})}`;
    if (!settings.karaokeEffect) {
      events.push(`Dialogue: 0,${formatAssTime(group[0].start)},${formatAssTime(groupEnd)},Caption,,0,0,0,,${position}${group.map((w) => transform(w.word)).join(' ')}`);
      return;
    }
    group.forEach((active, activeIndex) => {
      const start = active.start;
      const end = activeIndex < group.length - 1 ? group[activeIndex + 1].start : groupEnd;
      if (end <= start) return;
      const text = group
        .map((word, index) => (index === activeIndex ? `{\\c${highlight}&\\fscx108\\fscy108}${transform(word.word)}{\\c${primary}&\\fscx100\\fscy100}` : transform(word.word)))
        .join(' ');
      events.push(`Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Caption,,0,0,0,,${position}${text}`);
    });
  });

  return `${[...header, ...events].join('\n')}\n`;
}
