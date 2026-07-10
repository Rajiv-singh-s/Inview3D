'use client';

import { use } from 'react';
import Link from 'next/link';
import { useProjectStatus } from '@/hooks/useProjectStatus';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatMs } from '@/lib/format';
import type { StepStatus } from '@/types';

const STEP_ICON: Record<StepStatus, string> = {
  pending: '○',
  running: '◐',
  completed: '●',
  failed: '✕',
  skipped: '–',
};

const STEP_COLOR: Record<StepStatus, string> = {
  pending: 'text-slate-500',
  running: 'text-brand-400 animate-pulse',
  completed: 'text-emerald-400',
  failed: 'text-red-400',
  skipped: 'text-slate-600',
};

export default function ProcessingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading, isError, error } = useProjectStatus(id);

  if (isLoading) {
    return <p className="text-slate-400">Loading project status…</p>;
  }
  if (isError || !data) {
    return (
      <div className="card p-6">
        <p className="text-red-300">Could not load this project.</p>
        <p className="mt-1 text-sm text-slate-400">{(error as Error)?.message}</p>
        <Link href="/projects" className="btn-ghost mt-4">
          Back to projects
        </Link>
      </div>
    );
  }

  const isDone = data.status === 'completed';
  const isFailed = data.status === 'failed';

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Processing…</h1>
          <p className="mt-1 font-mono text-sm text-slate-500">{id}</p>
        </div>
        <StatusBadge status={data.status} />
      </div>

      <div className="card space-y-3 p-6">
        <div className="flex items-center justify-between text-sm">
          <span>Overall progress</span>
          <span className="tabular-nums text-slate-400">{data.progress}%</span>
        </div>
        <ProgressBar value={data.progress} />
      </div>

      <ol className="card divide-y divide-slate-800 p-2">
        {data.steps.map((step) => (
          <li key={step.id} className="flex items-center gap-3 px-4 py-3">
            <span className={`text-lg ${STEP_COLOR[step.status]}`}>{STEP_ICON[step.status]}</span>
            <span className="flex-1">{step.label}</span>
            {step.durationMs ? (
              <span className="text-xs tabular-nums text-slate-500">{formatMs(step.durationMs)}</span>
            ) : null}
          </li>
        ))}
      </ol>

      {isFailed && (
        <div className="card border-red-500/40 bg-red-500/5 p-6">
          <p className="font-medium text-red-300">Processing failed</p>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-red-200/80">
            {data.error ?? 'Unknown error'}
          </pre>
          <Link href="/capture" className="btn-ghost mt-4">
            Try another capture
          </Link>
        </div>
      )}

      {isDone && (
        <div className="card flex items-center justify-between border-emerald-500/40 bg-emerald-500/5 p-6">
          <div>
            <p className="font-medium text-emerald-300">Photosphere complete</p>
            <p className="text-sm text-emerald-200/80">Your panorama is ready to explore.</p>
          </div>
          <Link href={`/viewer/${id}`} className="btn-primary">
            Open viewer
          </Link>
        </div>
      )}
    </div>
  );
}
