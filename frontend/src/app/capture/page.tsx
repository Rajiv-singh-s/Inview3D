'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { useCaptureStore } from '@/store/captureStore';
import { ReviewDashboard } from '@/components/review/ReviewDashboard';
import { useRouter } from 'next/navigation';

// Dynamically import the Viewport to prevent SSR issues with navigator and WebGL
const CaptureViewport = dynamic(
  () => import('@/components/capture/CaptureViewport').then((m) => m.CaptureViewport),
  { ssr: false }
);

export default function CapturePage() {
  const router = useRouter();
  const capturedCount = useCaptureStore((state) => state.getCapturedCount());

  // Automatically transition to review when all 16 frames are captured
  if (capturedCount === 16) {
    return (
      <main className="fixed inset-0 w-full h-full bg-slate-950">
        <ReviewDashboard 
          onPost={(isPrivate) => {
            console.log('Stitch and post triggered. Private:', isPrivate);
            // Engine hooks for stitching could go here
            // router.push('/success');
          }} 
          onBack={() => {
            useCaptureStore.getState().resetCapture();
            router.push('/');
          }} 
        />
      </main>
    );
  }

  return (
    <main className="fixed inset-0 w-full h-full bg-slate-950">
      <CaptureViewport />
    </main>
  );
}
