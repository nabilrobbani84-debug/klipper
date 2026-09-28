import React, { useState } from 'react';
import {
  FolderOpen,
  Plus,
  Play,
  Film,
  Copy,
  Trash2,
  Edit2,
  ExternalLink,
  Clock,
  Layers,
  Sparkles,
} from 'lucide-react';
import { Project } from '../types';

interface ProjectsDashboardProps {
  projects: Project[];
  activeProjectId: string | null;
  onOpenProject: (project: Project) => void;
  onDuplicateProject: (project: Project) => void;
  onDeleteProject: (projectId: string) => void;
  onRenameProject: (projectId: string, newName: string) => void;
  onNewProjectClick: () => void;
}

export const ProjectsDashboard: React.FC<ProjectsDashboardProps> = ({
  projects,
  activeProjectId,
  onOpenProject,
  onDuplicateProject,
  onDeleteProject,
  onRenameProject,
  onNewProjectClick,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const startRename = (p: Project) => {
    setEditingId(p.id);
    setEditName(p.name);
  };

  const saveRename = (id: string) => {
    if (editName.trim()) {
      onRenameProject(id, editName.trim());
    }
    setEditingId(null);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-white/10 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FolderOpen className="w-4 h-4 text-purple-400" />
            <span className="text-xs uppercase font-extrabold text-purple-400 tracking-wider">
              Project Management
            </span>
          </div>
          <h1 className="text-3xl font-extrabold text-white">My Projects</h1>
          <p className="text-sm text-slate-400">
            All your processed YouTube clipping sessions and editor timelines
          </p>
        </div>

        <button
          onClick={onNewProjectClick}
          className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-purple-600/30 transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>New Clipping Project</span>
        </button>
      </div>

      {/* Projects Grid */}
      {projects.length === 0 ? (
        <div className="text-center py-20 glass-panel rounded-3xl border border-white/10 max-w-xl mx-auto p-8">
          <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 mx-auto mb-4">
            <FolderOpen className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">No Projects Found</h3>
          <p className="text-sm text-slate-400 mb-6">
            Paste any YouTube video link to start creating clips with ClipForge AI.
          </p>
          <button
            onClick={onNewProjectClick}
            className="px-6 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-lg shadow-purple-600/25 transition-all cursor-pointer"
          >
            Create New Project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((proj) => {
            const isActive = proj.id === activeProjectId;
            return (
              <div
                key={proj.id}
                className={`glass-card rounded-3xl border p-5 flex flex-col justify-between transition-all shadow-xl ${
                  isActive
                    ? 'border-purple-500/60 ring-1 ring-purple-500/30 shadow-purple-500/10'
                    : 'border-white/10 hover:border-white/20'
                }`}
              >
                <div>
                  {/* Thumbnail Banner */}
                  <div
                    onClick={() => onOpenProject(proj)}
                    className="relative aspect-video rounded-2xl overflow-hidden bg-black/60 border border-white/10 mb-4 cursor-pointer group shadow-inner"
                  >
                    <img
                      src={proj.videoInfo.thumbnailUrl}
                      alt={proj.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-80"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />

                    {/* Clip Count badge */}
                    <div className="absolute bottom-2.5 left-2.5 px-2 py-0.5 rounded-lg bg-black/80 backdrop-blur-sm text-[10px] font-mono text-purple-300 border border-purple-500/30 flex items-center gap-1 font-bold">
                      <Layers className="w-3 h-3 text-purple-400" />
                      <span>{proj.clips.length} Clips</span>
                    </div>

                    {/* Active badge */}
                    {isActive && (
                      <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-lg bg-purple-600 text-[10px] font-bold text-white shadow-md">
                        Active Project
                      </div>
                    )}
                  </div>

                  {/* Title / Rename input */}
                  {editingId === proj.id ? (
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && saveRename(proj.id)}
                        className="bg-black/60 text-white text-xs px-2.5 py-1 rounded-lg border border-purple-400 w-full focus:outline-none"
                        autoFocus
                      />
                      <button
                        onClick={() => saveRename(proj.id)}
                        className="px-2 py-1 rounded bg-purple-600 text-[11px] font-bold text-white"
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3
                        onClick={() => onOpenProject(proj)}
                        className="text-base font-bold text-white line-clamp-1 hover:text-purple-300 cursor-pointer transition-colors"
                      >
                        {proj.name}
                      </h3>
                      <button
                        onClick={() => startRename(proj)}
                        className="text-slate-400 hover:text-white p-1"
                        title="Rename Project"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  <p className="text-xs text-slate-400 line-clamp-1 mb-2">
                    Source: <span className="text-slate-300">{proj.videoInfo.channel}</span>
                  </p>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 mb-4">
                    <span>Last edited: {proj.lastEdited}</span>
                    <span className="capitalize text-emerald-400 font-semibold">{proj.status}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-3 border-t border-white/10">
                  <button
                    onClick={() => onOpenProject(proj)}
                    className="flex-1 py-2 px-3 rounded-xl bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/40 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Film className="w-3.5 h-3.5 text-purple-300" />
                    <span>Open Clips</span>
                  </button>

                  <button
                    onClick={() => onDuplicateProject(proj)}
                    title="Duplicate Project"
                    className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white border border-white/10 transition-colors cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => onDeleteProject(proj.id)}
                    title="Delete Project"
                    className="p-2 rounded-xl bg-white/5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border border-white/10 hover:border-rose-500/30 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
