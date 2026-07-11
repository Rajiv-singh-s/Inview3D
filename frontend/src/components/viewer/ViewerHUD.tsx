'use client';

import React from 'react';
import { useRouter } from 'next/navigation';

/**
 * Overlay HUD for the Viewer phase.
 * Features fullscreen toggle, home back button, and a help icon overlay.
 */
export const ViewerHUD: React.FC = () => {
  const router = useRouter();

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.warn(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  return (
    <div className="absolute inset-0 pointer-events-none z-30 flex flex-col justify-between p-4">
      
      {/* Top Bar */}
      <div className="flex justify-between items-start pointer-events-auto">
        <button 
          onClick={() => router.push('/')}
          className="p-3.5 rounded-full bg-white/10 border border-white/20 text-white backdrop-blur-md hover:bg-white/20 transition-colors shadow-lg active:scale-95"
          aria-label="Go Home"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7"/>
          </svg>
        </button>

        <div className="flex space-x-3">
          <button 
            className="p-3.5 rounded-full bg-white/10 border border-white/20 text-white backdrop-blur-md hover:bg-white/20 transition-colors shadow-lg active:scale-95"
            aria-label="Help"
            onClick={() => alert("Navigate the Splat:\n- 1 Finger: Orbit\n- 2 Fingers: Pinch to Zoom\n- Joystick: Pan Camera")}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          
          <button 
            onClick={toggleFullscreen}
            className="p-3.5 rounded-full bg-white/10 border border-white/20 text-white backdrop-blur-md hover:bg-white/20 transition-colors shadow-lg active:scale-95"
            aria-label="Toggle Fullscreen"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
        </div>
      </div>
      
    </div>
  );
};
