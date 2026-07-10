import type { ProjectStatus } from '@/types';

const STYLES: Record<ProjectStatus, string> = {
  uploaded: 'bg-slate-700 text-slate-200',
  queued: 'bg-amber-500/20 text-amber-300',
  processing: 'bg-brand-500/20 text-brand-400',
  completed: 'bg-emerald-500/20 text-emerald-300',
  failed: 'bg-red-500/20 text-red-300',
  canceled: 'bg-slate-600/40 text-slate-300',
};

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STYLES[status]}`}
    >
      {status}
    </span>
  );
}
