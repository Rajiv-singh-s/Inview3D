'use client';

import React, { use } from 'react';
import dynamic from 'next/dynamic';
import { ViewerHUD } from '@/components/viewer/ViewerHUD';

// Dynamically import SplatViewer to avoid WebGL and Document SSR issues
const SplatViewer = dynamic(
  () => import('@/components/viewer/SplatViewer').then(m => m.SplatViewer),
  { 
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 flex items-center justify-center bg-slate-950">
        <div className="w-10 h-10 border-4 border-slate-700 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    )
  }
);

interface ViewerPageProps {
  params: Promise<{ id: string }>;
}

export default function ViewerPage({ params }: ViewerPageProps) {
  // Unwrap the promise for params as required in Next.js 15
  const resolvedParams = use(params);
  const { id } = resolvedParams;

  return (
    <main className="fixed inset-0 w-full h-full bg-slate-950 overflow-hidden touch-none">
      <ViewerHUD />
      <SplatViewer id={id} />
    </main>
  );
}
