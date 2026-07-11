'use client';

import React from 'react';

/**
 * Props for AlignmentRing
 */
export interface AlignmentRingProps {
  /** Progress of alignment dwell (0 to 1) */
  dwellProgress: number;
  /** Whether the target is currently aligned */
  isAligned: boolean;
  /** Whether the frame has just been captured (triggers flash) */
  isCaptured: boolean;
}

/**
 * Central dynamic alignment ring (reticle) for capture sequence.
 * Provides visual feedback during the alignment and dwell capture process.
 */
export const AlignmentRing: React.FC<AlignmentRingProps> = ({ dwellProgress, isAligned, isCaptured }) => {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const clampedProgress = Math.max(0, Math.min(1, dwellProgress));
  const offset = circumference - clampedProgress * circumference;

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50">
      <div className="relative flex items-center justify-center">
        {/* Flash effect on capture */}
        {isCaptured && (
          <div className="absolute inset-0 w-48 h-48 -m-24 rounded-full bg-white animate-ping opacity-60" />
        )}
        
        {/* The SVG Ring */}
        <svg
          className="w-32 h-32 transform -rotate-90 drop-shadow-lg"
          viewBox="0 0 100 100"
        >
          {/* Background Track */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="transparent"
            stroke="rgba(255, 255, 255, 0.15)"
            strokeWidth="4"
          />
          
          {/* Progress Ring */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="transparent"
            stroke={isAligned ? '#34d399' : '#ffffff'} // Emerald-400 or White
            strokeWidth="5"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-[50ms] ease-linear"
          />
        </svg>

        {/* Center crosshair / dot */}
        <div className="absolute flex items-center justify-center">
          <div className={`w-1.5 h-1.5 rounded-full transition-colors duration-200 shadow-[0_0_8px_rgba(255,255,255,0.8)] ${isAligned ? 'bg-emerald-400' : 'bg-white'}`} />
        </div>
        
        <div className="absolute w-8 h-8 opacity-40">
          <div className="absolute top-0 left-1/2 -ml-[0.5px] w-[1px] h-2 bg-white" />
          <div className="absolute bottom-0 left-1/2 -ml-[0.5px] w-[1px] h-2 bg-white" />
          <div className="absolute left-0 top-1/2 -mt-[0.5px] w-2 h-[1px] bg-white" />
          <div className="absolute right-0 top-1/2 -mt-[0.5px] w-2 h-[1px] bg-white" />
        </div>
        
        {/* White Framing Rectangle (like Polycam/RealityScan) */}
        <div className="absolute w-64 h-80 border-2 border-white/40 pointer-events-none rounded-xl" />
      </div>
    </div>
  );
};
