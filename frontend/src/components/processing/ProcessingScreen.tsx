'use client';

import React from 'react';
import { SphericalPreview } from './SphericalPreview';

export interface ProcessingScreenProps {
  /** The processing progress (0 to 100) */
  progress: number;
  /** Text description of the current processing step (ignored, using fixed text to match video) */
  statusText?: string;
  onBack?: () => void;
}

/**
 * Phase 3 / 4 dark overlay screen displayed while the backend stitches the scan.
 */
export const ProcessingScreen: React.FC<ProcessingScreenProps> = ({ 
  progress, 
  onBack 
}) => {
  return (
    <div className="flex flex-col bg-black text-slate-100 min-h-screen z-50">
      {/* Header */}
      <div className="flex items-center p-5 pt-8">
        <button 
          onClick={onBack}
          className="text-white hover:text-slate-300 transition-colors"
          aria-label="Back"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <span className="ml-2 text-lg font-bold">Iriomote</span>
      </div>

      <div className="flex flex-col items-center justify-center flex-1 p-6 pb-32">
        <div className="mb-12 relative w-56 h-56 rounded-full overflow-hidden">
          <SphericalPreview />
        </div>
        
        <h2 className="text-[19px] font-bold mb-3 tracking-wide text-center">Generating 3D World</h2>
        <p className="text-[#a1a1aa] text-[13px] mb-6 text-center max-w-[260px] leading-relaxed">
          This will take about 5 minutes — feel free to leave the app and come back.
        </p>

        {/* Linear Progress Bar */}
        <div className="w-full max-w-[200px] h-1 bg-white/20 rounded-full overflow-hidden">
          <div 
            className="h-full bg-white transition-all duration-[800ms] ease-out"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      </div>
    </div>
  );
};
