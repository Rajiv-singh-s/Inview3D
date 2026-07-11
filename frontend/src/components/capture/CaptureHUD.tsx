'use client';

import React from 'react';
import { useCaptureStore } from '@/store/captureStore';

/**
 * Props for the CaptureHUD component
 */
export interface CaptureHUDProps {
  /** Callback when the user clicks Cancel */
  onCancel: () => void;
  /** Callback when the user clicks Review */
  onReview: () => void;
  /** Callback for manual capture (if no compass or fallback needed) */
  onManualSnap?: () => void;
  /** Whether the device is currently held stable */
  isStable: boolean;
  /** Total number of required photos */
  totalPhotos?: number;
  /** Override the text displayed */
  guidanceText?: React.ReactNode;
}

/**
 * The Heads-Up Display for the AR capture sequence.
 * Renders the top bar (cancel, counter) and bottom bar (guidance, progress, actions).
 */
export const CaptureHUD: React.FC<CaptureHUDProps> = ({
  onCancel,
  onReview,
  onManualSnap,
  isStable,
  totalPhotos = 16,
  guidanceText,
}) => {
  const capturedCount = useCaptureStore((state) => state.getCapturedCount());
  
  const progressPercent = Math.min(100, Math.max(0, (capturedCount / totalPhotos) * 100));
  const canReview = capturedCount > 0;
  const isComplete = capturedCount >= totalPhotos;

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between z-40 font-sans">
      {/* Top Bar */}
      <div className="w-full p-5 flex items-center justify-between pointer-events-auto bg-gradient-to-b from-black/80 via-black/40 to-transparent">
        <button
          onClick={onCancel}
          className="px-5 py-2 rounded-full bg-white/10 text-white text-sm font-semibold border border-white/20 backdrop-blur-md hover:bg-white/20 transition-colors shadow-sm"
        >
          Cancel
        </button>
        
        <div className="px-5 py-2 rounded-full bg-black/60 text-white text-sm font-bold border border-white/10 backdrop-blur-md shadow-sm">
          {capturedCount} of {totalPhotos}
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="w-full flex flex-col items-center pointer-events-auto bg-gradient-to-t from-black/90 via-black/50 to-transparent pt-16 pb-8 px-6">
        {/* Guidance Text */}
        <div className="mb-6 text-center flex items-center justify-center min-h-[2.5rem]">
          <p className="text-sm md:text-base font-bold tracking-wide transition-colors duration-300 text-white">
            {guidanceText ? guidanceText : (
              isComplete 
                ? 'Scan complete!'
                : 'Aim at the floating dots'
            )}
          </p>
        </div>

        {/* Progress Bar */}
        <div className="w-full max-w-md h-2 bg-white/20 rounded-full mb-8 overflow-hidden backdrop-blur-md border border-white/10">
          <div 
            className="h-full bg-emerald-400 transition-all duration-300 ease-out shadow-[0_0_10px_rgba(52,211,153,0.6)]"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Actions */}
        <div className="w-full max-w-md flex items-center justify-between">
          <div className="w-20">
            {onManualSnap && !isComplete && (
              <button
                onClick={onManualSnap}
                className="w-14 h-14 rounded-full border-[3px] border-white/60 bg-white/10 flex items-center justify-center backdrop-blur-md hover:bg-white/20 hover:border-white transition-all active:scale-90"
                aria-label="Manual Snap"
              >
                <div className="w-10 h-10 bg-white rounded-full opacity-90 shadow-sm" />
              </button>
            )}
          </div>
          
          <button
            onClick={onReview}
            disabled={!canReview}
            className={`
              px-8 py-3.5 rounded-full font-bold text-sm backdrop-blur-md transition-all
              ${canReview 
                ? 'bg-white/15 text-white border border-white/30 hover:bg-white/25 active:scale-95 shadow-[0_0_15px_rgba(255,255,255,0.1)]' 
                : 'bg-white/5 text-white/40 border border-white/5 cursor-not-allowed'
              }
            `}
          >
            Review {capturedCount > 0 && `(${capturedCount})`}
          </button>
        </div>
      </div>
    </div>
  );
};
