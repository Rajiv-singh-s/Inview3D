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

  // Find nearest uncaptured dot for the hint arrow
  const getNearestDotAngle = () => {
    let nearestDist = Infinity;
    let nearestAngle = 0;
    TARGETS.forEach(t => {
      if (!capturedRef.current[t.id]) {
        // Simple 2D angle difference for hint direction
        const dy = t.pitch - aim.pitch;
        const dx = t.yaw - aim.yaw;
        // Handle wrap-around
        let wrapDx = dx;
        if (wrapDx > 180) wrapDx -= 360;
        if (wrapDx < -180) wrapDx += 360;
        
        const dist = Math.sqrt(wrapDx * wrapDx + dy * dy);
        if (dist < nearestDist && dist > 5) { // don't point if we are very close
          nearestDist = dist;
          nearestAngle = Math.atan2(dy, wrapDx) * (180 / Math.PI);
        }
      }
    });
    return -nearestAngle; // Invert for screen rotation
  };

  const capture = useCallback(
    (targetId: number) => {
      if (!videoRef.current || capturingRef.current) return;
      capturingRef.current = true;
      
      const video = videoRef.current;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const cw = window.innerWidth * 0.75;
      const ch = window.innerHeight * 0.55;

      if (!vw || !vh || !cw || !ch) return;

      // Calculate object-cover crop
      const scale = Math.max(cw / vw, ch / vh);
      const scaledW = vw * scale;
      const scaledH = vh * scale;

      const offsetX = (scaledW - cw) / 2;
      const offsetY = (scaledH - ch) / 2;

      const cropX = offsetX / scale;
      const cropY = offsetY / scale;
      const cropW = cw / scale;
      const cropH = ch / scale;

      const canvas = document.createElement('canvas');
      canvas.width = cropW;
      canvas.height = cropH;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
      }
      
      // Trigger flash
      setFlash(true);
      setTimeout(() => setFlash(false), 150);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
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

  const requestMotion = useCallback(async () => {
    const D = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof D?.requestPermission === 'function') {
      try {
        await D.requestPermission();
      } catch {
        /* denied — capture still runs */
      }
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    // 1) Motion permission FIRST — an `await getUserMedia` before this breaks the
    //    iOS user-gesture requirement and silently kills device orientation.
    await requestMotion();
    // 2) Camera.
    try {
      const stream = await navigator.mediaDevices
        .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false })
        .catch(() => navigator.mediaDevices.getUserMedia({ video: true, audio: false }));
      streamRef.current = stream;
      setStarted(true);
    } catch (err) {
      setError(`Could not access the camera: ${(err as Error).message}`);
    }
  }, [requestMotion]);

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
    window.addEventListener('deviceorientationabsolute', onOrientation as EventListener, true);
    return () => {
      window.removeEventListener('deviceorientation', onOrientation, true);
      window.removeEventListener('deviceorientationabsolute', onOrientation as EventListener, true);
    };
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
            liveVideo={videoRef.current}
          />
        </div>
      )}

      {/* LAYER 1: Hidden Video Source */}
      {started && (
        <video ref={videoRef} className="hidden" playsInline muted autoPlay />
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
            {/* Rotating Hint Arrow */}
            {arrowDeg != null && !aligned && (
              <div 
                className="absolute left-1/2 top-1/2 w-16 h-16 -translate-x-1/2 -translate-y-1/2 transition-transform duration-300"
                style={{ transform: `translate(-50%, -50%) rotate(${arrowDeg}deg)` }}
              >
                <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-full text-white font-bold text-xl drop-shadow-md">
                  ┘
                </div>
              </div>
            )}
            <div className="relative grid h-[70px] w-[70px] place-items-center rounded-full border-[3px] border-white drop-shadow-md">
              {aligned && (
                <svg className="absolute inset-0 h-full w-full -rotate-90 scale-[0.8]" viewBox="0 0 32 32">
                  <circle r="16" cx="16" cy="16" fill="transparent" stroke="#16a34a" strokeWidth="32" strokeDasharray={`${(dwell * 100.53).toFixed(2)} 100.53`} />
                </svg>
              )}
            </div>
          </div>

          {/* Capture flash */}
          {flash && (
            <div className="absolute z-40 bg-white" style={{ left: '50%', top: '50%', width: '75%', height: '55%', transform: 'translate(-50%, -50%)' }} />
          )}

          {/* Top HUD */}
          <div className="absolute top-8 left-6 right-6 z-40 flex justify-between items-center pointer-events-none">
            <button
              onClick={() => {
                const ids = Object.keys(capturedRef.current).map(Number).sort((a, b) => b - a);
                if (ids.length) {
                  store.removeFrame(ids[0]);
                  delete capturedRef.current[ids[0]];
                  setCount(Object.keys(capturedRef.current).length);
                }
              }}
              className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center pointer-events-auto text-white"
              aria-label="Undo"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
            </button>
            <button
              onClick={() => {
                store.resetCapture();
                router.push('/');
              }}
              className="w-10 h-10 rounded-full bg-red-600 flex items-center justify-center pointer-events-auto text-white"
              aria-label="Cancel"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>

          {/* Bottom HUD */}
          <div className="absolute bottom-6 left-0 right-0 z-40 flex flex-col items-center">
            <div className="text-white text-[15px] font-medium tracking-wide mb-6 text-center px-8 drop-shadow-md">
              Shoot all photos from the same spot as your<br/>initial photo to ensure an optimal result.
            </div>
            
            <div className="w-full relative h-[6px] bg-white/20">
              <div 
                className="absolute left-0 top-0 bottom-0 bg-[#22c55e] transition-all duration-500 ease-out"
                style={{ width: `${(count / 16) * 100}%` }}
              />
              <div className="absolute right-4 -top-8 text-white font-medium text-sm drop-shadow-md">
                {count} of 16
              </div>
            </div>
            {!hasCompass && (
              <div className="mt-4 flex flex-col items-center gap-2">
                <p className="text-center text-[12px] text-amber-300">
                  Motion sensor not active — dots need it. Tap Enable, or capture manually.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={requestMotion}
                    className="pointer-events-auto rounded-full bg-white/90 px-4 py-1.5 text-xs font-semibold text-slate-900"
                  >
                    Enable motion
                  </button>
                  <button
                    onClick={() => {
                      const next = TARGETS.find((t) => !capturedRef.current[t.id]);
                      if (next) capture(next.id);
                    }}
                    className="pointer-events-auto rounded-full bg-green-500 px-4 py-1.5 text-xs font-semibold text-white"
                  >
                    Capture
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
