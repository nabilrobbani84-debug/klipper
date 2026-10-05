import { execFile } from 'node:child_process';

export interface ExecOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  maxBuffer?: number;
}

export interface ExecResult { stdout: string; stderr: string; }

export class ExecError extends Error {
  constructor(message: string, public readonly stderr: string, public readonly aborted: boolean) {
    super(message);
    this.name = 'ExecError';
  }
}

/** Runs a binary without a shell (no injection surface), with timeout and cancellation support. */
export function run(bin: string, args: string[], options: ExecOptions): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: options.timeoutMs, signal: options.signal, maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const aborted = error.name === 'AbortError' || Boolean(options.signal?.aborted);
        const tail = String(stderr ?? '').split('\n').filter(Boolean).slice(-8).join('\n');
        reject(new ExecError(`${bin} failed: ${error.message}`, tail, aborted));
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
