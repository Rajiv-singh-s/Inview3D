'use client';

import React, { useState } from 'react';
import { GeoLocation } from './GeoLocation';
import { PrivacyToggle } from './PrivacyToggle';
import { useCaptureStore } from '@/store/captureStore';

export interface ReviewDashboardProps {
  /** Callback triggered when user clicks 'Stitch and post' */
  onPost: (isPrivate: boolean) => void;
  /** Callback triggered when user clicks back button */
  onBack: () => void;
}

/**
 * The main review screen (Phase 2).
 * Displays captured images, location data, privacy toggle, and post actions.
 */
export const ReviewDashboard: React.FC<ReviewDashboardProps> = ({ onPost, onBack }) => {
  const [isPrivate, setIsPrivate] = useState(false);
  
  const capturedFrames = useCaptureStore((state) => state.capturedFrames);
  const frames = Object.values(capturedFrames);
  const frameCount = frames.length;

  return (
    <div className="absolute inset-0 bg-slate-950 text-slate-100 flex flex-col p-5 space-y-6 overflow-y-auto z-50">
      {/* Header */}
      <div className="flex items-center justify-between pt-2 pb-2">
        <button 
          onClick={onBack}
          className="p-2.5 rounded-full bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 transition-colors backdrop-blur-sm"
          aria-label="Back"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-xl font-bold tracking-wide">Review Scan</h1>
        <div className="w-11" /> {/* spacer for centering */}
      </div>

      {/* Image Grid */}
      <div className="flex flex-col space-y-3">
        <h2 className="text-[15px] font-bold text-white">
          Source images ({frameCount})
        </h2>
        
        {frameCount > 0 ? (
          <div className="flex overflow-x-auto gap-3 pb-2 snap-x hide-scrollbar">
            {frames.map((frame, idx) => (
              <div key={frame.targetId} className="relative flex-none w-36 h-36 rounded-xl overflow-hidden bg-slate-800/50 border border-white/10 shadow-sm snap-start">
                {frame.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={frame.thumbnailUrl} alt={`Frame ${idx + 1}`} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-500 bg-white/5 text-center p-1">No Image</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="h-28 rounded-xl bg-white/5 border border-white/10 border-dashed flex items-center justify-center text-slate-400 text-sm">
            No frames captured
          </div>
        )}
      </div>

      {/* Details Section */}
      <div className="flex flex-col space-y-4 pt-2 bg-white/5 rounded-2xl p-4 border border-white/10">
        <h2 className="text-[15px] font-bold text-white">Details</h2>
        
        <PrivacyToggle isPrivate={isPrivate} onChange={setIsPrivate} />
        
        <div className="h-px bg-white/10 my-2" />
        
        <GeoLocation />
      </div>

      {/* Bottom Spacer & CTA */}
      <div className="flex-1 min-h-[1rem]" />
      <div className="flex flex-col space-y-3 pb-4">
        <button 
          onClick={() => onPost(isPrivate)}
          className="w-full py-4 rounded-full bg-slate-100 text-black font-bold text-[17px] hover:bg-white transition-all active:scale-[0.98]"
        >
          Stitch and post
        </button>
        <button 
          onClick={onBack}
          className="w-full py-2 text-slate-400 font-medium text-[15px] hover:text-white transition-colors"
        >
          Not now
        </button>
      </div>
    </div>
  );
};
