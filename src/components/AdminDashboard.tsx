import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Users, HardDrive, Cpu, RefreshCw, Loader2, RotateCcw, XCircle, Server } from 'lucide-react';
import { admin, AdminOverview, AdminUser, BackendJob } from '../services/apiClient';

interface AdminDashboardProps {
  onError: (message: string) => void;
}

const PLANS = ['FREE', 'CREATOR', 'PRO'] as const;
const ACTIVE = ['QUEUED', 'DOWNLOADING', 'EXTRACTING_AUDIO', 'TRANSCRIBING', 'ANALYZING', 'GENERATING_CLIPS', 'REFRAMING', 'GENERATING_CAPTIONS', 'RENDERING', 'UPLOADING'];

function bytes(n: number): string {
  if (n > 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n > 1e6) return `${(n / 1e6).toFixed(0)} MB`;
  return `${(n / 1e3).toFixed(0)} KB`;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onError }) => {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [jobs, setJobs] = useState<Array<BackendJob & { userEmail: string | null; projectName: string | null }>>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async (searchTerm = '') => {
    try {
      const [o, j, u] = await Promise.all([admin.overview(), admin.jobs(), admin.users(searchTerm || undefined)]);
      setOverview(o);
      setJobs(j);
      setUsers(u);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to load admin data.');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => admin.overview().then(setOverview).catch(() => undefined), 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      await refresh(search);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-purple-400" /></div>;

  const kpis = [
    { label: 'Users', value: overview?.users ?? 0, sub: `${overview?.active_users_30d ?? 0} active (30d)`, icon: Users },
    { label: 'Active jobs', value: overview?.active_jobs ?? 0, sub: `${overview?.completed_jobs_7d ?? 0} done · ${overview?.failed_jobs_7d ?? 0} failed (7d)`, icon: Activity },
    { label: 'Workers online', value: overview?.workersOnline ?? 0, sub: `avg render ${Math.round(overview?.avg_render_seconds ?? 0)}s`, icon: Cpu },
    { label: 'Storage used', value: bytes(overview?.export_bytes ?? 0), sub: `${overview?.ai_calls_month ?? 0} AI calls (mo)`, icon: HardDrive },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-white/10 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-xs uppercase font-extrabold text-cyan-400 tracking-wider">Administration</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white">Admin control plane</h1>
          <p className="text-sm text-slate-400">Live metrics, job queue and user management</p>
        </div>
        <button onClick={() => void refresh(search)} className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold flex items-center gap-2 cursor-pointer">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className="glass-card p-4 rounded-2xl border border-white/10">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1"><span>{kpi.label}</span><Icon className="w-4 h-4 text-purple-400" /></div>
              <div className="text-2xl font-extrabold text-white">{kpi.value}</div>
              <span className="text-[11px] text-slate-400 font-medium">{kpi.sub}</span>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-panel p-5 rounded-3xl border border-white/10">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2"><Server className="w-4 h-4 text-purple-400" /> Recent jobs</h3>
          <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
            {jobs.length === 0 && <p className="text-xs text-slate-500">No jobs yet.</p>}
            {jobs.map((job) => {
              const isActive = ACTIVE.includes(job.state);
              const isFailed = job.state === 'FAILED' || job.state === 'CANCELLED';
              return (
                <div key={job.id} className="p-3 rounded-xl bg-black/30 border border-white/5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate">{job.projectName ?? job.projectId}</div>
                      <div className="text-[10px] text-slate-500 truncate">{job.userEmail ?? job.userId} · {job.kind}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${job.state === 'COMPLETED' ? 'bg-emerald-500/20 text-emerald-300' : isFailed ? 'bg-rose-500/20 text-rose-300' : 'bg-cyan-500/20 text-cyan-300'}`}>{job.state}</span>
                      {isActive && <button onClick={() => act(`cancel-${job.id}`, () => admin.cancelJob(job.id))} disabled={busy === `cancel-${job.id}`} className="p-1 rounded text-slate-400 hover:text-rose-300 cursor-pointer"><XCircle className="w-3.5 h-3.5" /></button>}
                      {isFailed && <button onClick={() => act(`retry-${job.id}`, () => admin.retryJob(job.id))} disabled={busy === `retry-${job.id}`} className="p-1 rounded text-slate-400 hover:text-purple-300 cursor-pointer"><RotateCcw className="w-3.5 h-3.5" /></button>}
                    </div>
                  </div>
                  {job.errorCode && <p className="text-[10px] text-rose-400 mt-1 font-mono">{job.errorCode}: {job.message}</p>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="glass-panel p-5 rounded-3xl border border-white/10">
          <div className="flex items-center justify-between mb-4 gap-3">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2"><Users className="w-4 h-4 text-purple-400" /> Users</h3>
            <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void refresh(search)} placeholder="Search email…" className="px-2.5 py-1 rounded-lg bg-black/40 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500" />
          </div>
          <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
            {users.map((u) => (
              <div key={u.id} className="p-3 rounded-xl bg-black/30 border border-white/5">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white truncate flex items-center gap-1.5">{u.email}{u.role === 'admin' && <span className="text-[9px] px-1 rounded bg-cyan-500/20 text-cyan-300">ADMIN</span>}</div>
                    <div className="text-[10px] text-slate-500">{u.projects} projects · {u.creditsUsed} credits used{u.suspended && ' · suspended'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <select value={u.plan} onChange={(e) => act(`plan-${u.id}`, () => admin.updateUser(u.id, { plan: e.target.value }))} disabled={busy === `plan-${u.id}`} className="px-2 py-1 rounded-lg bg-black/40 border border-white/10 text-[10px] text-white cursor-pointer">
                    {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <button onClick={() => act(`susp-${u.id}`, () => admin.updateUser(u.id, { suspended: !u.suspended }))} disabled={busy === `susp-${u.id}`} className={`px-2 py-1 rounded-lg text-[10px] font-semibold cursor-pointer ${u.suspended ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>{u.suspended ? 'Unsuspend' : 'Suspend'}</button>
                  <button onClick={() => act(`reset-${u.id}`, () => admin.resetUsage(u.id))} disabled={busy === `reset-${u.id}`} className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-white/5 text-slate-300 hover:bg-white/10 cursor-pointer">Reset usage</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
