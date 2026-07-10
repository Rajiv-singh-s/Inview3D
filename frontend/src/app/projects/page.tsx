'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { formatBytes } from '@/lib/format';
import type { Project } from '@/types';

export default function ProjectsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.listProjects(),
    refetchInterval: 5000,
  });

  const del = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Projects</h1>
        <Link href="/capture" className="btn-primary">
          New capture
        </Link>
      </div>

      {isLoading && <p className="text-slate-400">Loading projects…</p>}
      {isError && <p className="text-red-300">Failed to load projects.</p>}

      {data && data.length === 0 && (
        <div className="card p-10 text-center">
          <p className="text-slate-300">No projects yet.</p>
          <Link href="/capture" className="btn-primary mt-4 inline-flex">
            Capture your first photosphere
          </Link>
        </div>
      )}

      <div className="grid gap-4">
        {data?.map((project: Project) => (
          <div key={project.id} className="card flex flex-col gap-3 p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate font-semibold">{project.originalName}</p>
                <p className="font-mono text-xs text-slate-500">{project.id}</p>
              </div>
              <StatusBadge status={project.status} />
            </div>

            {project.status === 'processing' || project.status === 'queued' ? (
              <ProgressBar value={project.progress} />
            ) : null}

            <div className="flex items-center justify-between text-sm text-slate-400">
              <span>
                {new Date(project.createdAt).toLocaleString()}
                {project.panoramaSizeBytes ? ` · ${formatBytes(project.panoramaSizeBytes)}` : ''}
              </span>
              <div className="flex gap-3">
                {project.status === 'completed' ? (
                  <Link href={`/viewer/${project.id}`} className="text-brand-400 hover:underline">
                    Open viewer
                  </Link>
                ) : (
                  <Link
                    href={`/processing/${project.id}`}
                    className="text-brand-400 hover:underline"
                  >
                    View status
                  </Link>
                )}
                <button
                  onClick={() => {
                    if (confirm('Delete this project and all its artifacts?')) {
                      del.mutate(project.id);
                    }
                  }}
                  className="text-red-400 hover:underline"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
