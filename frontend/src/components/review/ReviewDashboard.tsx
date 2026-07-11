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
  
  const frames = useCaptureStore((state) => state.getCapturedArray());
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
        <h2 className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
          Source images ({frameCount})
        </h2>
        
        {frameCount > 0 ? (
          <div className="grid grid-cols-4 gap-2">
            {frames.map((frame, idx) => (
              <div key={frame.targetId} className="relative aspect-square rounded-xl overflow-hidden bg-slate-800/50 border border-white/10 shadow-sm">
                {frame.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={frame.thumbnailUrl} alt={`Frame ${idx + 1}`} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-500 bg-white/5 text-center p-1">No Image</div>
                )}
                <div className="absolute top-1 right-1 bg-black/70 backdrop-blur-md rounded-full px-1.5 py-0.5 text-[10px] font-mono border border-white/20 text-white shadow-sm">
                  {idx + 1}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="h-28 rounded-xl bg-white/5 border border-white/10 border-dashed flex items-center justify-center text-slate-400 text-sm">
            No frames captured
          </div>
        )}
      </div>

      {/* Settings Section */}
      <div className="flex flex-col space-y-3 pt-2">
        <h2 className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Location</h2>
        <GeoLocation />
      </div>

      <div className="flex flex-col space-y-3 pt-2">
        <h2 className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Privacy Settings</h2>
        <PrivacyToggle isPrivate={isPrivate} onChange={setIsPrivate} />
      </div>

      {/* Bottom Spacer & CTA */}
      <div className="flex-1 min-h-[2rem]" />
      <button 
        onClick={() => onPost(isPrivate)}
        className="w-full py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold text-lg shadow-[0_0_20px_rgba(79,70,229,0.3)] hover:from-blue-500 hover:to-indigo-500 transition-all active:scale-[0.98] border border-blue-400/20 mb-4"
      >
        Stitch and post
      </button>
    </div>
  );
};
