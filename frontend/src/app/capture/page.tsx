'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Phase = 'intro' | 'capturing';

// WebGL + camera — client only.
const CubeCapture = dynamic(
  () => import('@/components/cube/CubeCapture').then((m) => m.CubeCapture),
  { ssr: false, loading: () => <p className="text-slate-400">Starting capture…</p> },
);

/**
 * iOS 13+ gates DeviceOrientationEvent behind an explicit user gesture, so the
 * capture screen can only start from a button press. Other browsers resolve
 * immediately; capture still works without a compass via the drag fallback.
 */
async function requestMotionPermission(): Promise<void> {
  const D = window.DeviceOrientationEvent as unknown as {
    requestPermission?: () => Promise<'granted' | 'denied'>;
  };
  if (typeof D?.requestPermission === 'function') {
    try {
      await D.requestPermission();
    } catch {
      /* guidance is optional */
    }
  }
}

export default function CapturePage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('intro');

  const start = async () => {
    await requestMotionPermission();
    setPhase('capturing');
  };

  if (phase === 'capturing') {
    return (
      <CubeCapture
        onComplete={(id) => router.push(`/viewer/${id}`)}
        onCancel={() => setPhase('intro')}
      />
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Capture a room</h1>
        <p className="mt-2 text-slate-400">
          Stand in the middle of the room and slowly turn. The cube around you fills in live as each
          wall is captured automatically — no shutter button.
        </p>
      </div>

      <ol className="card space-y-3 p-6 text-sm text-slate-300">
        <li>
          <strong className="text-white">1.</strong> Stand still — pivot on the spot, don&apos;t
          walk.
        </li>
        <li>
          <strong className="text-white">2.</strong> Point at the wall the guide names and hold
          steady.
        </li>
        <li>
          <strong className="text-white">3.</strong> Each wall snaps automatically when aligned,
          sharp, and steady.
        </li>
        <li>
          <strong className="text-white">4.</strong> Cover all four walls, the ceiling and the
          floor, then finish.
        </li>
      </ol>

      <button onClick={start} className="btn-primary w-full">
        Start capture
      </button>
      <p className="text-center text-xs text-slate-500">
        Requires camera access. On iOS you&apos;ll also be asked for motion access.
      </p>
    </div>
  );
}
