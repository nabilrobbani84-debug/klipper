export interface ByteRange { start: number; end: number; }

/** Parses a single-range HTTP Range header ("bytes=start-end"). Returns null when absent/invalid. */
export function parseRangeHeader(header: string | null | undefined, size: number): ByteRange | 'unsatisfiable' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startText, endText] = match;
  if (startText === '' && endText === '') return null;
  let start: number;
  let end: number;
  if (startText === '') {
    start = Math.max(0, size - Number(endText));
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText === '' ? size - 1 : Math.min(Number(endText), size - 1);
  }
  if (start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}
