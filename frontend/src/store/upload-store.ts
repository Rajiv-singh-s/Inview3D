import { create } from 'zustand';
import type { UploadResponse } from '@/types';

type UploadPhase = 'idle' | 'uploading' | 'done' | 'error';

interface UploadState {
  file: File | null;
  phase: UploadPhase;
  progress: number;
  error: string | null;
  result: UploadResponse | null;
  abort: AbortController | null;

  setFile: (file: File | null) => void;
  start: (abort: AbortController) => void;
  setProgress: (p: number) => void;
  succeed: (result: UploadResponse) => void;
  fail: (message: string) => void;
  reset: () => void;
}

/**
 * Zustand store for the single active upload. Keeps upload UI state out of
 * React tree so the dropzone, progress bar and metadata panel stay in sync.
 */
export const useUploadStore = create<UploadState>((set, get) => ({
  file: null,
  phase: 'idle',
  progress: 0,
  error: null,
  result: null,
  abort: null,

  setFile: (file) => set({ file, phase: 'idle', progress: 0, error: null, result: null }),
  start: (abort) => set({ phase: 'uploading', progress: 0, error: null, abort }),
  setProgress: (progress) => set({ progress }),
  succeed: (result) => set({ phase: 'done', progress: 100, result, abort: null }),
  fail: (message) => set({ phase: 'error', error: message, abort: null }),
  reset: () => {
    get().abort?.abort();
    set({ file: null, phase: 'idle', progress: 0, error: null, result: null, abort: null });
  },
}));
