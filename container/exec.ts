import { spawn } from 'node:child_process';

export interface ExecOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  maxBuffer?: number;
  /** Streaming stdout callback (e.g. FFmpeg `-progress pipe:1`). */
  onStdout?: (chunk: string) => void;
}

export interface ExecResult { stdout: string; stderr: string; }

export class ExecError extends Error {
  constructor(message: string, public readonly stderr: string, public readonly aborted: boolean) {
    super(message);
    this.name = 'ExecError';
  }
}

/** Runs a binary without a shell (no injection surface), with timeout, cancellation and bounded output. */
export function run(bin: string, args: string[], options: ExecOptions): Promise<ExecResult> {
  const maxBuffer = options.maxBuffer ?? 16 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new ExecError(`${bin} aborted`, '', true));
      return;
    }
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let aborted = false;
    let timedOut = false;
    const kill = () => {
      if (!child.killed) child.kill('SIGKILL');
    };
    const onAbort = () => {
      aborted = true;
      kill();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, options.timeoutMs);
    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      options.onStdout?.(text);
      if (!options.onStdout && stdout.length < maxBuffer) stdout += text;
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr = (stderr + data.toString()).slice(-64 * 1024);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      reject(new ExecError(`${bin} failed to start: ${error.message}`, stderr, aborted));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      const tail = stderr.split('\n').filter(Boolean).slice(-8).join('\n');
      if (aborted) reject(new ExecError(`${bin} aborted`, tail, true));
      else if (timedOut) reject(new ExecError(`${bin} timed out`, tail, false));
      else if (code !== 0) reject(new ExecError(`${bin} exited with code ${code}`, tail, false));
      else resolve({ stdout, stderr });
    });
  });
}
