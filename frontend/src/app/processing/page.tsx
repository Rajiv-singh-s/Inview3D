'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ProcessingScreen } from '@/components/processing/ProcessingScreen';
import { api } from '@/lib/api';

function ProcessingPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get('id');

  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('Uploading photos…');
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setFailed('No capture id.');
      return;
    }
    let stop = false;

    const poll = async () => {
      try {
        const s = await api.getCaptureStatus(id);
        if (stop) return;

        setProgress(typeof s.progress === 'number' ? s.progress : 0);
        if (s.status === 'completed') {
          setStatusText('Loading 3D scene…');
          setProgress(100);
          setTimeout(() => router.push(`/viewer/${id}`), 800);
          return; // stop polling
        }
        if (s.status === 'failed') {
          setFailed(s.error || 'Reconstruction failed.');
          return;
        }
        setStatusText((s.progress ?? 0) < 20 ? 'Preparing photos…' : 'Stitching your 360° room…');
        setTimeout(poll, 1500);
      } catch {
        if (!stop) setTimeout(poll, 2000); // transient network error, keep trying
      }
    };
    poll();
    return () => {
      stop = true;
    };
  }, [id, router]);

  if (failed) {
    return (
      <main className="fixed inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950 p-6 text-center text-white">
        <p className="text-lg font-semibold text-red-300">Generation failed</p>
        <p className="max-w-md text-sm text-slate-400">{failed}</p>
        <button
          onClick={() => router.push('/capture')}
          className="mt-2 rounded-xl bg-indigo-500 px-5 py-2.5 font-medium"
        >
          Try again
        </button>
      </main>
    );
  }

  return <ProcessingScreen progress={progress} statusText={statusText} onBack={() => router.push('/')} />;
}

export default function ProcessingPage() {
  return (
    <Suspense fallback={<ProcessingScreen progress={0} statusText="Loading…" />}>
      <ProcessingPageContent />
    </Suspense>
  );
}
