import React, { useState } from 'react';
import {
  Settings,
  Activity,
  Users,
  Cpu,
  Server,
  Database,
  DollarSign,
  Terminal,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Filter,
} from 'lucide-react';

interface JobItem {
  id: string;
  videoTitle: string;
  user: string;
  status: 'running' | 'completed' | 'queued' | 'failed';
  time: string;
  duration: string;
  gpuNode: string;
}

export const AdminDashboard: React.FC = () => {
  const [logFilter, setLogFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all');
  const [aiProvider, setAiProvider] = useState<'gemini-3.8-flash' | 'whisper-local' | 'hybrid'>('gemini-3.8-flash');
  const [jobs, setJobs] = useState<JobItem[]>([
    {
      id: 'job-9821',
      videoTitle: 'The Unseen Shift in AI: 90% of Creators Left Behind',
      user: 'nabilrobbani84@gmail.com',
      status: 'completed',
      time: '2m ago',
      duration: '14.2s',
      gpuNode: 'node-us-east4-a',
    },
    {
      id: 'job-9822',
      videoTitle: 'How We Scaled Micro-Tool to $350K/Month',
      user: 'creator_studio@agency.co',
      status: 'completed',
      time: '12m ago',
      duration: '18.9s',
      gpuNode: 'node-us-east4-b',
    },
    {
      id: 'job-9823',
      videoTitle: 'Neuroscience of Dopamine & Hyperfocus Reset',
      user: 'sarah.vids@tokgrowth.io',
      status: 'running',
      time: 'Just now',
      duration: 'In progress',
      gpuNode: 'node-asia-east1-c',
    },
    {
      id: 'job-9824',
      videoTitle: '10 Secrets of High-Retention Video Hooks',
      user: 'viral_shorts_lab@gmail.com',
      status: 'queued',
      time: '1m ago',
      duration: 'Waiting',
      gpuNode: 'Pending',
    },
  ]);

  const logs = [
    { type: 'info', time: '10:24:12', msg: '[Gemini 3.8 Flash] Audio tokens processed: 3,420 tokens in 420ms' },
    { type: 'info', time: '10:24:14', msg: '[FFmpeg Worker #4] 1080p H.264 encode finished with avg 84fps' },
    { type: 'warn', time: '10:22:50', msg: '[YouTube OEMBED] Rate-limit backoff: delaying request by 250ms' },
    { type: 'info', time: '10:21:05', msg: '[Billing] Subscription renewed: Pro Plan $59 from user #10842' },
    { type: 'error', time: '10:18:22', msg: '[Transcoder] Corrupted frame in video segment at 00:44 (Recovered)' },
  ];

  const filteredLogs = logs.filter((l) => (logFilter === 'all' ? true : l.type === logFilter));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-white/10 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-xs uppercase font-extrabold text-cyan-400 tracking-wider">
              System Administration
            </span>
          </div>
          <h1 className="text-3xl font-extrabold text-white">ClipForge Control Plane</h1>
          <p className="text-sm text-slate-400">
            Real-time infrastructure health, AI models, rendering workers, and job queues
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs font-mono text-slate-300 flex items-center gap-2">
            <Server className="w-3.5 h-3.5 text-emerald-400" />
            <span>Cluster: RUNNING (99.98%)</span>
          </div>
        </div>
      </div>

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="glass-card p-4 rounded-2xl border border-white/10">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Total Active Users</span>
            <Users className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-extrabold text-white">14,820</div>
          <span className="text-[11px] text-emerald-400 font-semibold">+18% this week</span>
        </div>

        <div className="glass-card p-4 rounded-2xl border border-white/10">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Processing Jobs</span>
            <Activity className="w-4 h-4 text-pink-400" />
          </div>
          <div className="text-2xl font-extrabold text-white">142,590</div>
          <span className="text-[11px] text-purple-300 font-semibold">99.4% completion rate</span>
        </div>

        <div className="glass-card p-4 rounded-2xl border border-white/10">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>GPU Worker Nodes</span>
            <Cpu className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-extrabold text-white">24 / 32</div>
          <span className="text-[11px] text-cyan-300 font-semibold">Avg render latency 16s</span>
        </div>

        <div className="glass-card p-4 rounded-2xl border border-white/10">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Monthly Recurring Rev</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-extrabold text-white">$64,280</div>
          <span className="text-[11px] text-emerald-400 font-semibold">+24% MoM</span>
        </div>
      </div>

      {/* Grid: Jobs Table + Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Jobs Table */}
        <div className="lg:col-span-2 glass-panel p-5 rounded-3xl border border-white/10">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Live Video Processing Queue
            </h3>
            <span className="text-xs text-slate-400 font-mono">4 Jobs Monitored</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-slate-400 font-semibold pb-2">
                  <th className="pb-2">Job ID / Video</th>
                  <th className="pb-2">Creator</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Node</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-white/[0.02]">
                    <td className="py-2.5 pr-2">
                      <div className="font-bold text-white line-clamp-1">{job.videoTitle}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{job.id} • {job.time}</div>
                    </td>
                    <td className="py-2.5 text-slate-300 pr-2 truncate max-w-[120px]">{job.user}</td>
                    <td className="py-2.5 pr-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          job.status === 'completed'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : job.status === 'running'
                            ? 'bg-cyan-500/20 text-cyan-300 animate-pulse'
                            : 'bg-amber-500/20 text-amber-300'
                        }`}
                      >
                        {job.status}
                      </span>
                    </td>
                    <td className="py-2.5 text-slate-400 font-mono text-[10px]">{job.gpuNode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* AI Model Configuration */}
        <div className="glass-panel p-5 rounded-3xl border border-white/10 space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            AI Engine Configuration
          </h3>

          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-2">
              Primary Language & Analysis Model
            </label>
            <div className="space-y-2">
              {[
                { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (Active)', note: 'Recommended: fastest reasoning & hook scoring' },
                { id: 'whisper-local', name: 'Local Neural Whisper v3', note: 'Direct audio tokenization on GPU' },
                { id: 'hybrid', name: 'Hybrid Cascade Engine', note: 'Fallback pipeline for high throughput' },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => setAiProvider(m.id as any)}
                  className={`w-full p-2.5 rounded-xl border text-left text-xs transition-all ${
                    aiProvider === m.id
                      ? 'bg-purple-600/25 border-purple-400 text-white'
                      : 'bg-black/30 border-white/5 text-slate-400 hover:text-white'
                  }`}
                >
                  <div className="font-bold">{m.name}</div>
                  <div className="text-[10px] text-slate-500">{m.note}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2 border-t border-white/10">
            <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
              <span>Dynamic Concurrency Limit</span>
              <span className="font-mono text-purple-300">64 slots</span>
            </div>
            <input type="range" min="16" max="128" defaultValue="64" className="w-full accent-purple-500" />
          </div>
        </div>
      </div>

      {/* System Audit Logs */}
      <div className="glass-panel p-5 rounded-3xl border border-white/10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              System Audit Logs
            </h3>
          </div>

          <div className="flex gap-1 bg-white/5 p-1 rounded-xl text-xs">
            {(['all', 'info', 'warn', 'error'] as const).map((lvl) => (
              <button
                key={lvl}
                onClick={() => setLogFilter(lvl)}
                className={`px-2.5 py-0.5 rounded-lg uppercase text-[10px] font-bold transition-all ${
                  logFilter === lvl ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5 font-mono text-[11px] bg-black/60 p-3 rounded-2xl border border-white/5 max-h-48 overflow-y-auto">
          {filteredLogs.map((l, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="text-slate-500">{l.time}</span>
              <span
                className={`font-bold uppercase text-[9px] px-1 rounded ${
                  l.type === 'info'
                    ? 'text-cyan-400 bg-cyan-950/60'
                    : l.type === 'warn'
                    ? 'text-amber-400 bg-amber-950/60'
                    : 'text-rose-400 bg-rose-950/60'
                }`}
              >
                {l.type}
              </span>
              <span className="text-slate-200">{l.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
