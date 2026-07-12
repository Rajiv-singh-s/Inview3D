'use client';

import React, { use } from 'react';
import dynamic from 'next/dynamic';
import { ViewerHUD } from '@/components/viewer/ViewerHUD';

// Dynamically import the panorama viewer to avoid WebGL/SSR issues.
const PanoramaViewer = dynamic(
  () => import('@/components/viewer/PanoramaViewer').then((m) => m.PanoramaViewer),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 flex items-center justify-center bg-slate-950">
        <div className="w-10 h-10 border-4 border-slate-700 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    ),
  },
);

interface ViewerPageProps {
  params: Promise<{ id: string }>;
}

export default function ViewerPage({ params }: ViewerPageProps) {
  const { id } = use(params);

  return (
    <main className="fixed inset-0 w-full h-full bg-slate-950 overflow-hidden touch-none">
      <ViewerHUD />
      <PanoramaViewer id={id} />
    </main>
  );
}
