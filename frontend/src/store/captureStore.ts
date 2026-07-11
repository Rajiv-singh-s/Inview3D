import { create } from 'zustand';
import type { CapturedFrame, GeoLocation } from '@/types';

export interface CaptureState {
  // Capture Session
  isCapturing: boolean;
  capturedFrames: Record<number, CapturedFrame>; // Keyed by targetId
  lastCapturedId: number | null;
  
  // Geolocation
  location: GeoLocation | null;
  setLocation: (loc: GeoLocation) => void;

  // Actions
  startCapture: () => void;
  addFrame: (frame: CapturedFrame) => void;
  removeFrame: (targetId: number) => void;
  resetCapture: () => void;
  
  // Derived state getters
  getCapturedCount: () => number;
}

export const useCaptureStore = create<CaptureState>((set, get) => ({
  isCapturing: false,
  capturedFrames: {},
  lastCapturedId: null,
  location: null,

  setLocation: (loc) => set({ location: loc }),

  startCapture: () => set({ isCapturing: true, capturedFrames: {}, lastCapturedId: null, location: null }),
  
  addFrame: (frame) => set((state) => ({
    capturedFrames: { ...state.capturedFrames, [frame.targetId]: frame },
    lastCapturedId: frame.targetId,
  })),

  removeFrame: (targetId) => set((state) => {
    const newFrames = { ...state.capturedFrames };
    delete newFrames[targetId];
    return { capturedFrames: newFrames };
  }),

  resetCapture: () => set({ isCapturing: false, capturedFrames: {}, lastCapturedId: null, location: null }),

  getCapturedCount: () => Object.keys(get().capturedFrames).length,
}));
