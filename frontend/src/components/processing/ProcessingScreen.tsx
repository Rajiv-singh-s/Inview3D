'use client';

import React from 'react';
import { SphericalPreview } from './SphericalPreview';

export interface ProcessingScreenProps {
  /** The processing progress (0 to 100) */
  progress: number;
  /** Text description of the current processing step */
  statusText?: string;
}

/**
 * Phase 3 / 4 dark overlay screen displayed while the backend stitches the scan.
 */
export const ProcessingScreen: React.FC<ProcessingScreenProps> = ({ 
  progress, 
  statusText = 'Processing your scan...' 
}) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-slate-100 p-6 z-50">
      
      <div className="mb-10 relative">
        <SphericalPreview />
        
        {/* Pulsing ring overlay */}
        <div className="absolute inset-0 rounded-full border border-blue-500/50 animate-ping shadow-[0_0_15px_rgba(59,130,246,0.6)]" />
      </div>
      
      <h2 className="text-xl font-bold mb-2 tracking-wide text-center">{statusText}</h2>
      <p className="text-slate-400 text-sm mb-8 text-center">This may take a few moments...</p>

      {/* Linear Progress Bar */}
      <div className="w-full max-w-sm h-3 bg-white/10 rounded-full overflow-hidden backdrop-blur-sm border border-white/5 relative">
        <div 
          className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-[800ms] ease-out"
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>
      
      <div className="mt-4 text-xs font-mono text-slate-500">
        {Math.round(progress)}%
      </div>
    </div>
  );
};
