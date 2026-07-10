'use client';

import { use } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useProjectStatus } from '@/hooks/useProjectStatus';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatMs } from '@/lib/format';
import type { StepStatus } from '@/types';

const RotatingSphere = dynamic(
  () => import('@/components/processing/RotatingSphere').then((m) => m.RotatingSphere),
  { ssr: false, loading: () => <div className="h-[250px] w-[250px] mx-auto rounded-full bg-slate-900 animate-pulse" /> },
);

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
    <div className="mx-auto max-w-xl space-y-8 text-center">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <span className="font-mono text-xs text-slate-500">{id}</span>
        <StatusBadge status={data.status} />
      </div>

      <div className="space-y-4">
        {/* Rotating 3D Sphere Preview */}
        {!isFailed && !isDone && <RotatingSphere />}

        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Generating 3D World</h1>
          <p className="text-sm text-slate-400">
            This will take about 5 minutes — feel free to leave the app and come back.
          </p>
        </div>
      </div>

      <div className="card space-y-3 p-6">
        <div className="flex items-center justify-between text-sm">
          <span>Overall progress</span>
          <span className="tabular-nums text-slate-400">{data.progress}%</span>
        </div>
        <ProgressBar value={data.progress} />
      </div>

      <ol className="card divide-y divide-slate-800 p-2 text-left">
        {data.steps.map((step) => (
          <li key={step.id} className="flex items-center gap-3 px-4 py-3">
            <span className={`text-lg ${STEP_COLOR[step.status]}`}>{STEP_ICON[step.status]}</span>
            <span className="flex-1 text-sm">{step.label}</span>
            {step.durationMs ? (
              <span className="text-xs tabular-nums text-slate-500">{formatMs(step.durationMs)}</span>
            ) : null}
          </li>
        ))}
      </ol>

      {isFailed && (
        <div className="card border-red-500/40 bg-red-500/5 p-6 text-left">
          <p className="font-medium text-red-300">Processing failed</p>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-red-200/80">
            {data.error ?? 'Unknown error'}
          </pre>
          <Link href="/capture" className="btn-ghost mt-4 w-full text-center">
            Try another capture
          </Link>
        </div>
      )}

      {isDone && (
        <div className="card flex flex-col sm:flex-row items-center justify-between gap-4 border-emerald-500/40 bg-emerald-500/5 p-6 text-left">
          <div>
            <p className="font-medium text-emerald-300">Photosphere complete</p>
            <p className="text-sm text-emerald-200/80">Your panorama is ready to explore.</p>
          </div>
          <Link href={`/viewer/${id}`} className="btn-primary w-full sm:w-auto text-center">
            Open viewer
          </Link>
        </div>
      )}
    </div>
  );
}
