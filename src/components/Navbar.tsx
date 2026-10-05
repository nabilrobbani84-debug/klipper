import React from 'react';
import {
  Scissors,
  Sparkles,
  Film,
  FolderOpen,
  LayoutTemplate,
  Download,
  Activity,
  Zap,
  LogIn,
  LogOut,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { UserAccount } from '../types';

type Tab = 'landing' | 'clips' | 'studio' | 'projects' | 'templates' | 'exports' | 'queue' | 'admin';

interface NavbarProps {
  currentTab: Tab;
  setCurrentTab: (tab: Tab) => void;
  user: UserAccount | null;
  isAdmin: boolean;
  onOpenSubscription: () => void;
  onOpenLegal: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  hasActiveProject: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setCurrentTab,
  user,
  isAdmin,
  onOpenSubscription,
  onOpenLegal,
  onSignIn,
  onSignOut,
  hasActiveProject,
}) => {
  return (
    <header className="sticky top-0 z-50 glass-panel border-b border-white/10 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand Logo */}
        <div
          onClick={() => setCurrentTab('landing')}
          className="flex items-center gap-3 cursor-pointer group select-none"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 via-indigo-600 to-pink-500 p-0.5 shadow-lg shadow-purple-500/25 group-hover:scale-105 transition-transform duration-200">
            <div className="w-full h-full bg-[#0b0d14] rounded-[10px] flex items-center justify-center">
              <Scissors className="w-5 h-5 text-purple-400 group-hover:rotate-12 transition-transform duration-200" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-purple-200 bg-clip-text text-transparent">
                ClipForge
              </span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                AI
              </span>
            </div>
            <p className="text-[10px] text-slate-400 hidden sm:block">AI YouTube Clipper</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="hidden md:flex items-center gap-1 bg-white/[0.03] p-1 rounded-xl border border-white/5">
          <button
            onClick={() => setCurrentTab('landing')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              currentTab === 'landing'
                ? 'bg-purple-600/30 text-purple-200 border border-purple-500/40 shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            Create Clips
          </button>

          {hasActiveProject && (
            <>
              <button
                onClick={() => setCurrentTab('clips')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  currentTab === 'clips'
                    ? 'bg-purple-600/30 text-purple-200 border border-purple-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                AI Clips
              </button>

              <button
                onClick={() => setCurrentTab('studio')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  currentTab === 'studio'
                    ? 'bg-purple-600/30 text-purple-200 border border-purple-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Film className="w-3.5 h-3.5 text-cyan-400" />
                Video Studio
              </button>
            </>
          )}

          {user && (
            <>
              <button
                onClick={() => setCurrentTab('projects')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  currentTab === 'projects' ? 'bg-purple-600/30 text-purple-200 border border-purple-500/40 shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Projects
              </button>

              <button
                onClick={() => setCurrentTab('queue')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  currentTab === 'queue' ? 'bg-purple-600/30 text-purple-200 border border-purple-500/40 shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                Queue
              </button>

              <button
                onClick={() => setCurrentTab('exports')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  currentTab === 'exports' ? 'bg-purple-600/30 text-purple-200 border border-purple-500/40 shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Download className="w-3.5 h-3.5" />
                Exports
              </button>
            </>
          )}

          <button
            onClick={() => setCurrentTab('templates')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              currentTab === 'templates' ? 'bg-purple-600/30 text-purple-200 border border-purple-500/40 shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <LayoutTemplate className="w-3.5 h-3.5" />
            Templates
          </button>

          {isAdmin && (
            <button
              onClick={() => setCurrentTab('admin')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                currentTab === 'admin' ? 'bg-purple-600/30 text-purple-200 border border-purple-500/40 shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              Admin
            </button>
          )}
        </nav>

        {/* User Account & Actions */}
        <div className="flex items-center gap-3">
          {/* Legal notice button */}
          <button
            onClick={onOpenLegal}
            title="Copyright & Platform Guidelines"
            className="hidden sm:flex items-center gap-1 text-slate-400 hover:text-slate-200 text-xs px-2.5 py-1.5 rounded-lg hover:bg-white/5 transition-colors border border-transparent hover:border-white/10"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Fair Use & Terms</span>
          </button>

          {user ? (
            <>
              <button
                onClick={onOpenSubscription}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-950/60 to-indigo-950/60 border border-purple-500/30 hover:border-purple-400/50 transition-all text-xs cursor-pointer"
                title="Credits remaining this month"
              >
                <Zap className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
                <span className="font-semibold text-slate-200">{Math.max(0, user.credits)} credits</span>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold uppercase bg-purple-500/30 text-purple-200">{user.plan}</span>
              </button>

              <div className="w-8 h-8 rounded-full ring-2 ring-purple-500/30 overflow-hidden" title={user.email}>
                <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
              </div>

              <button onClick={onSignOut} title="Sign out" className="hidden sm:flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer">
                <LogOut className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button
              onClick={onSignIn}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold text-xs transition-all cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5" />
              Sign in
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
