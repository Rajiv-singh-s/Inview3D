'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { StatusResponse } from '@/types';

/**
 * Polls a project's status every 2s until it reaches a terminal state.
 * Backed by TanStack Query so caching/retries are handled for us.
 */
export function useProjectStatus(id: string) {
  return useQuery<StatusResponse>({
    queryKey: ['status', id],
    queryFn: () => api.getStatus(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      const terminal = status === 'completed' || status === 'failed' || status === 'canceled';
      return terminal ? false : 2000;
    },
  });
}
