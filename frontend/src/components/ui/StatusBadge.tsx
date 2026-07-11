import type { ProjectStatus } from '@/types';

const STYLES: Record<ProjectStatus, string> = {
  uploading: 'bg-blue-500/20 text-blue-300',
  processing: 'bg-yellow-500/20 text-yellow-300',
  completed: 'bg-emerald-500/20 text-emerald-300',
  failed: 'bg-red-500/20 text-red-300',
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
