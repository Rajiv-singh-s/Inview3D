'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CapturedShot, GuidedCapture } from '@/components/capture/GuidedCapture';
import { api, ApiError } from '@/lib/api';

type Phase = 'intro' | 'capturing' | 'uploading' | 'error';

/**
 * iOS 13+ gates DeviceOrientationEvent behind an explicit user gesture, so the
 * capture screen can only start from a button press. Other browsers resolve
 * immediately.
 */
async function requestMotionPermission(): Promise<void> {
  const D = window.DeviceOrientationEvent as unknown as {
    requestPermission?: () => Promise<'granted' | 'denied'>;
  };
  if (typeof D?.requestPermission === 'function') {
    const result = await D.requestPermission();
    if (result !== 'granted') {
      throw new Error('Motion access denied — capture guidance needs the compass.');
    }
  }
}

export default function CapturePage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('intro');
  const [shots, setShots] = useState<CapturedShot[]>([]);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    try {
      await requestMotionPermission();
      setShots([]);
      setPhase('capturing');
    } catch (err) {
      // Guidance is optional; capture still works with manual shots.
      console.warn(err);
      setShots([]);
      setPhase('capturing');
    }
  };

  const addShot = useCallback((shot: CapturedShot) => {
    setShots((prev) => (prev.length >= 16 ? prev : [...prev, shot]));
  }, []);

  const undo = useCallback(() => setShots((prev) => prev.slice(0, -1)), []);

  const finish = async () => {
    if (shots.length < 4) return;
    setPhase('uploading');
    try {
      const res = await api.uploadCapture(
        shots.map((s) => s.blob),
        `Capture ${new Date().toLocaleString()}`,
      );
      router.push(`/processing/${res.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unexpected error uploading photos');
      setPhase('error');
    }
  };

  if (phase === 'intro') {
    return (
      <div className="mx-auto max-w-xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold">Capture a photosphere</h1>
          <p className="mt-2 text-slate-400">
            Stand in one spot and slowly rotate. We&apos;ll take 16 photos automatically and stitch
            them into an explorable 360° view.
          </p>
        </div>

        <ol className="card space-y-3 p-6 text-sm text-slate-300">
          <li>
            <strong className="text-white">1.</strong> Stand still — pivot on the spot, don&apos;t
            walk.
          </li>
          <li>
            <strong className="text-white">2.</strong> Hold the phone upright and rotate slowly.
          </li>
          <li>
            <strong className="text-white">3.</strong> Each photo is taken automatically when you
            reach the next angle.
          </li>
          <li>
            <strong className="text-white">4.</strong> Keep textured surfaces in view — blank walls
            can&apos;t be matched.
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

  if (phase === 'error') {
    return (
      <div className="card mx-auto max-w-xl border-red-500/40 bg-red-500/5 p-6">
        <p className="font-medium text-red-300">Capture failed</p>
        <p className="mt-1 text-sm text-red-200/80">{error}</p>
        <div className="mt-4 flex gap-3">
          <button onClick={finish} className="btn-primary">
            Retry upload
          </button>
          <button onClick={() => setPhase('intro')} className="btn-ghost">
            Start over
          </button>
        </div>
      </div>
    );
  }

  return (
    <GuidedCapture
      shots={shots}
      onShot={addShot}
      onUndo={undo}
      onFinish={finish}
      onCancel={() => setPhase('intro')}
      busy={phase === 'uploading'}
    />
  );
}
