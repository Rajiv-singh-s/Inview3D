'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCaptureStore } from '@/store/captureStore';
import { ReviewDashboard } from '@/components/review/ReviewDashboard';
import { api, ApiError } from '@/lib/api';

// Dynamically import the Viewport to prevent SSR issues with navigator and WebGL
const CaptureViewport = dynamic(
  () => import('@/components/capture/CaptureViewport').then((m) => m.CaptureViewport),
  { ssr: false },
);

export default function CapturePage() {
  const router = useRouter();
  const capturedCount = useCaptureStore((state) => state.getCapturedCount());
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const handlePost = async () => {
    setUploading(true);
    setUploadError(null);
    try {
      // Gather the captured photos in target order.
      const frames = useCaptureStore.getState().capturedFrames;
      const blobs = Object.keys(frames)
        .map(Number)
        .sort((a, b) => a - b)
        .map((k) => frames[k].blob);

      const res = await api.uploadPhotos(blobs, `Room ${new Date().toLocaleString()}`);
      useCaptureStore.getState().resetCapture();
      router.push(`/processing?id=${res.id}`);
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Upload failed. Check your connection.');
      setUploading(false);
    }
  };

  // Show the review + submit screen once all 16 frames are captured.
  if (capturedCount === 16) {
    return (
      <main className="fixed inset-0 w-full h-full bg-slate-950">
        {uploadError && (
          <div className="absolute inset-x-0 top-0 z-50 bg-red-600 px-4 py-2 text-center text-sm text-white">
            {uploadError}
          </div>
        )}
        {uploading && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-slate-950/80 text-white">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-700 border-t-indigo-500" />
            <p className="text-sm text-slate-300">Uploading photos…</p>
          </div>
        )}
        <ReviewDashboard
          onPost={handlePost}
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
