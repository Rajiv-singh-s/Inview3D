'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ProcessingScreen } from '@/components/processing/ProcessingScreen';

function ProcessingPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get('id') || 'demo-id';
  
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('Initializing pipeline...');

  useEffect(() => {
    // In a real scenario, we would use TanStack React Query to poll the backend here.
    // e.g. const { data } = useQuery(['captureStatus', id], () => fetchStatus(id), { refetchInterval: 2000 })
    
    // Simulating the polling progress:
    let currentProgress = 0;
    const interval = setInterval(() => {
      currentProgress += (Math.random() * 8);
      
      if (currentProgress < 30) {
        setStatusText('Extracting features...');
      } else if (currentProgress < 60) {
        setStatusText('Computing Structure from Motion...');
      } else if (currentProgress < 90) {
        setStatusText('Training Gaussian Splats...');
      } else {
        setStatusText('Finalizing model...');
      }

      if (currentProgress >= 100) {
        currentProgress = 100;
        setProgress(100);
        clearInterval(interval);
        
        setTimeout(() => {
          // Navigate to viewer phase when complete
          router.push(`/viewer/${id}`);
        }, 1200);
      } else {
        setProgress(currentProgress);
      }
    }, 1200);

    return () => clearInterval(interval);
  }, [id, router]);

  return <ProcessingScreen progress={progress} statusText={statusText} />;
}

export default function ProcessingPage() {
  return (
    <Suspense fallback={<ProcessingScreen progress={0} statusText="Loading..." />}>
      <ProcessingPageContent />
    </Suspense>
  );
}
