'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCaptureStore } from '@/store/captureStore';
import { StitchedWorld } from './StitchedWorld';

/** 16 capture targets over the sphere: 8-dot horizon ring + 4 up + 4 down. */
const TARGETS: { id: number; yaw: number; pitch: number }[] = [
  ...[0, 45, 90, 135, 180, 225, 270, 315].map((yaw, i) => ({ id: i, yaw, pitch: 0 })),
  ...[45, 135, 225, 315].map((yaw, i) => ({ id: 8 + i, yaw, pitch: 35 })),
  ...[45, 135, 225, 315].map((yaw, i) => ({ id: 12 + i, yaw, pitch: -35 })),
];

/** Reticle sits at the centre of the camera box (upper-centre of the screen). */
const RETICLE_X = 50; // %
const RETICLE_Y = 45; // %
/** Degrees→percent placement, tuned so the camera-box edge ≈ the camera FOV. */
const KX = 0.95;
const KY = 0.8;
/** Only targets within this cone of the aim are drawn. */
const VISIBLE_CONE = 72;
/** Alignment + dwell for auto-capture. */
const TOLERANCE = 11;
const DWELL_MS = 320;

function angleDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

function readAim(e: DeviceOrientationEvent): { yaw: number; pitch: number } | null {
  const webkit = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
  const yawRaw = typeof webkit === 'number' ? webkit : e.alpha != null ? 360 - e.alpha : null;
  if (yawRaw == null || Number.isNaN(yawRaw) || e.beta == null) return null;
  return { yaw: ((yawRaw % 360) + 360) % 360, pitch: Math.max(-90, Math.min(90, 90 - e.beta)) };
}

/**
 * Guided capture matching the reference app: the live camera sits in a bordered
 * box in the upper-centre, green target dots float around it and move as you
 * turn, a centre reticle shows a directional arrow toward the next dot, and each
 * dot auto-captures when it reaches the centre — no shutter button.
 */
export const CaptureViewport: React.FC = () => {
  const router = useRouter();
  const store = useCaptureStore();

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const aimRef = useRef({ yaw: 0, pitch: 0 });
  const baseYawRef = useRef<number | null>(null);
  const capturedRef = useRef<Record<number, boolean>>({});
  const dwellStartRef = useRef<number | null>(null);
  const capturingRef = useRef(false);

  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasCompass, setHasCompass] = useState(false);
  const [aim, setAim] = useState({ yaw: 0, pitch: 0 });
  const [dwell, setDwell] = useState(0);
  const [flash, setFlash] = useState(false);
  const [count, setCount] = useState(0);

  const capture = useCallback(
    (targetId: number) => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0 || capturingRef.current) return;
      capturingRef.current = true;

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')!.drawImage(video, 0, 0);
      const thumb = canvas.toDataURL('image/jpeg', 0.5);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            capturedRef.current[targetId] = true;
            store.addFrame({
              targetId,
              blob,
              thumbnailUrl: thumb,
              pose: { yaw: aimRef.current.yaw, pitch: aimRef.current.pitch, roll: 0, timestamp: Date.now() },
              sharpness: 1,
            });
            setCount(Object.keys(capturedRef.current).length);
            setFlash(true);
            setTimeout(() => setFlash(false), 110);
          }
          dwellStartRef.current = null;
          setDwell(0);
          setTimeout(() => (capturingRef.current = false), 300);
        },
        'image/jpeg',
        0.9,
      );
    },
    [store],
  );

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices
        .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false })
        .catch(() => navigator.mediaDevices.getUserMedia({ video: true, audio: false }));
      streamRef.current = stream;
      const D = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
      if (typeof D?.requestPermission === 'function') {
        try {
          await D.requestPermission();
        } catch {
          /* optional */
        }
      }
      setStarted(true);
    } catch (err) {
      setError(`Could not access the camera: ${(err as Error).message}`);
    }
  }, []);

  // Attach stream once the video element is mounted
  useEffect(() => {
    if (started && videoRef.current && streamRef.current && !videoRef.current.srcObject) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => undefined);
    }
  }, [started]);

  useEffect(() => {
    if (!started) return;
    const onOrientation = (e: DeviceOrientationEvent) => {
      const raw = readAim(e);
      if (!raw) return;
      setHasCompass(true);
      if (baseYawRef.current == null) baseYawRef.current = raw.yaw;
      const yaw = ((raw.yaw - baseYawRef.current) % 360 + 360) % 360;
      aimRef.current = { yaw, pitch: raw.pitch };
      setAim(aimRef.current);
    };
    window.addEventListener('deviceorientation', onOrientation, true);
    return () => window.removeEventListener('deviceorientation', onOrientation, true);
  }, [started]);

  // nearest uncaptured target, for the arrow/hint and capture
  const nearest = useMemo(() => {
    let best: { id: number; err: number; dYaw: number; dPitch: number } | null = null;
    for (const t of TARGETS) {
      if (capturedRef.current[t.id]) continue;
      const dYaw = angleDelta(aim.yaw, t.yaw);
      const dPitch = t.pitch - aim.pitch;
      const err = Math.hypot(dYaw * Math.cos((aim.pitch * Math.PI) / 180), dPitch);
      if (!best || err < best.err) best = { id: t.id, err, dYaw, dPitch };
    }
    return best;
  }, [aim, count]);

  useEffect(() => {
    if (!started) return;
    let raf = 0;
    const tick = () => {
      let best: { id: number; err: number } | null = null;
      for (const t of TARGETS) {
        if (capturedRef.current[t.id]) continue;
        const dYaw = angleDelta(aimRef.current.yaw, t.yaw) * Math.cos((aimRef.current.pitch * Math.PI) / 180);
        const err = Math.hypot(dYaw, t.pitch - aimRef.current.pitch);
        if (!best || err < best.err) best = { id: t.id, err };
      }
      if (best && best.err <= TOLERANCE && !capturingRef.current) {
        const now = performance.now();
        if (dwellStartRef.current == null) dwellStartRef.current = now;
        const held = now - dwellStartRef.current;
        setDwell(Math.min(1, held / DWELL_MS));
        if (held >= DWELL_MS) capture(best.id);
      } else {
        dwellStartRef.current = null;
        setDwell(0);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, capture]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  const aligned = dwell > 0;
  // arrow angle from reticle toward the nearest target's projected position
  const arrowDeg =
    nearest && !aligned
      ? (Math.atan2(-nearest.dPitch * KY, nearest.dYaw * KX) * 180) / Math.PI
      : null;
  const hint =
    nearest && !aligned
      ? Math.abs(nearest.dYaw) >= Math.abs(nearest.dPitch)
        ? nearest.dYaw > 0
          ? 'Turn right'
          : 'Turn left'
        : nearest.dPitch > 0
          ? 'Tilt up'
          : 'Tilt down'
      : null;

  useEffect(() => {
    if (count >= 16) {
      setTimeout(() => router.push('/review'), 500);
    }
  }, [count, router]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black touch-none select-none font-sans">
      
      {/* Start gate */}
      {!started && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-black p-6 text-center text-white">
          <h2 className="text-2xl font-bold">Capture your room</h2>
          <p className="max-w-xs text-[15px] text-white/70">
            Stand in one spot and slowly turn. Line each green dot up with the centre — photos are
            taken automatically.
          </p>
          <button onClick={start} className="mt-4 rounded-full bg-[#4040ff] px-8 py-3.5 font-bold text-white tracking-wide">
            Start capture
          </button>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      )}

      {/* LAYER 0: Background AR (Captured Photos in the Void) */}
      {started && (
        <div className="absolute inset-0 z-0 bg-black">
          <StitchedWorld 
            currentAim={aim} 
            capturedFrames={store.capturedFrames} 
            activeTargetId={null}
            capturedIds={new Set(Object.keys(capturedRef.current).map(Number))}
            mode="background"
          />
        </div>
      )}

      {/* LAYER 1: Live Video Window */}
      {started && (
        <div
          className="absolute z-10 overflow-hidden bg-black"
          style={{ left: '50%', top: '50%', width: '75%', height: '55%', transform: 'translate(-50%, -50%)' }}
        >
          <video ref={videoRef} className="h-full w-full object-cover" playsInline muted autoPlay />
        </div>
      )}

      {/* LAYER 2: White Viewfinder Border */}
      {started && (
        <div
          className="pointer-events-none absolute z-20 border-[1.5px] border-white/80"
          style={{ left: '50%', top: '50%', width: '75%', height: '55%', transform: 'translate(-50%, -50%)' }}
        />
      )}

      {/* LAYER 3: Foreground AR (Target Dots over the video) */}
      {started && (
        <div className="absolute inset-0 z-30 pointer-events-none">
          <StitchedWorld 
            currentAim={aim} 
            capturedFrames={{}} 
            activeTargetId={nearest?.id ?? null}
            capturedIds={new Set(Object.keys(capturedRef.current).map(Number))}
            mode="foreground"
          />
        </div>
      )}

      {/* LAYER 4: Reticle & UI */}
      {started && (
        <>
          {/* Centre reticle */}
          <div
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 z-40"
            style={{ left: '50%', top: '50%' }}
          >
            <div className="relative grid h-[70px] w-[70px] place-items-center rounded-full border-[3px] border-white drop-shadow-md">
              {aligned && (
                <svg className="absolute inset-0 h-full w-full -rotate-90 scale-[0.8]" viewBox="0 0 32 32">
                  <circle r="16" cx="16" cy="16" fill="transparent" stroke="#16a34a" strokeWidth="32" strokeDasharray={`${(dwell * 100.53).toFixed(2)} 100.53`} />
                </svg>
              )}
              {arrowDeg != null && !aligned && (
                <div className="absolute inset-0 flex items-center justify-center" style={{ transform: `rotate(${arrowDeg}deg)` }}>
                  <div className="absolute w-[80px] h-[80px] border-r-[4px] border-b-[4px] border-white rounded-br-sm opacity-90 shadow-sm" style={{ transform: 'translateX(20px)' }} />
                </div>
              )}
            </div>
          </div>

          {/* Capture flash */}
          <div className="pointer-events-none absolute inset-0 bg-white transition-opacity duration-75 z-50" style={{ opacity: flash ? 0.8 : 0 }} />

          {/* Top HUD */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between p-6 pt-12 z-50">
            <button
              onClick={() => {
                const ids = Object.keys(capturedRef.current).map(Number).sort((a, b) => b - a);
                if (ids.length) {
                  store.removeFrame(ids[0]);
                  delete capturedRef.current[ids[0]];
                  setCount(Object.keys(capturedRef.current).length);
                }
              }}
              className="flex h-[36px] w-[36px] items-center justify-center rounded-full bg-white text-black drop-shadow-md"
              aria-label="Undo"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
            </button>
            <button
              onClick={() => {
                store.resetCapture();
                router.push('/');
              }}
              className="flex h-[36px] w-[36px] items-center justify-center rounded-full bg-[#ef4444] text-white drop-shadow-md"
              aria-label="Cancel"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>

          {/* Bottom HUD - 100% clone of reference video */}
          <div className="absolute inset-x-0 bottom-0 z-50 flex flex-col">
            <div className="px-8 pb-10 flex flex-col items-center">
              <p className="text-center text-[14px] text-white/90 drop-shadow-md leading-relaxed">
                Shoot all photos from the same spot as your initial photo to ensure an optimal result.
              </p>
              {!hasCompass && (
                <p className="text-center text-[11px] text-white/50 mt-2">
                  No motion sensor detected.
                </p>
              )}
            </div>
            
            <div className="w-full relative h-[6px] bg-white/20">
              <div className="absolute right-3 -top-6 text-[13px] font-bold text-white drop-shadow-md">
                {count} of 16
              </div>
              <div className="h-full bg-[#16a34a] transition-all duration-200" style={{ width: `${(count / 16) * 100}%` }} />
            </div>
          </div>
        </>
      )}
    </div>
  );
};
