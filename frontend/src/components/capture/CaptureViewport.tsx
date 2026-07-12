'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCaptureStore } from '@/store/captureStore';

/** 16 capture targets over the sphere: an 8-dot horizon ring + 4 up + 4 down. */
const TARGETS: { id: number; yaw: number; pitch: number }[] = [
  ...[0, 45, 90, 135, 180, 225, 270, 315].map((yaw, i) => ({ id: i, yaw, pitch: 0 })),
  ...[0, 90, 180, 270].map((yaw, i) => ({ id: 8 + i, yaw, pitch: 40 })),
  ...[0, 90, 180, 270].map((yaw, i) => ({ id: 12 + i, yaw, pitch: -40 })),
];

/** Half-FOV used to spread dots across the screen (visual guidance, not camera intrinsics). */
const HALF_FOV = 55;
/** A dot is "aligned" once within this many degrees of the reticle. */
const TOLERANCE = 12;
/** Hold aligned this long before the shot fires (matches the reference pie-fill). */
const DWELL_MS = 350;

function angleDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

/** Read a device-orientation event as a (yaw, pitch) aim in degrees. */
function readAim(e: DeviceOrientationEvent): { yaw: number; pitch: number } | null {
  const webkit = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
  const yawRaw = typeof webkit === 'number' ? webkit : e.alpha != null ? 360 - e.alpha : null;
  if (yawRaw == null || Number.isNaN(yawRaw) || e.beta == null) return null;
  return { yaw: ((yawRaw % 360) + 360) % 360, pitch: Math.max(-90, Math.min(90, e.beta - 90)) };
}

/**
 * Full-screen guided capture, matching the reference app: the live camera fills
 * the viewport, green target dots float over it and move as you turn, and each
 * dot auto-captures when it reaches the centre reticle. No shutter button.
 */
export const CaptureViewport: React.FC = () => {
  const router = useRouter();
  const store = useCaptureStore();

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Live values read by the rAF loop (refs so the loop never goes stale).
  const aimRef = useRef({ yaw: 0, pitch: 0 });
  const baseYawRef = useRef<number | null>(null);
  const capturedRef = useRef<Record<number, boolean>>({});
  const dwellStartRef = useRef<number | null>(null);
  const capturingRef = useRef(false);

  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasCompass, setHasCompass] = useState(false);
  const [aim, setAim] = useState({ yaw: 0, pitch: 0 });
  const [activeId, setActiveId] = useState<number | null>(null);
  const [dwell, setDwell] = useState(0);
  const [flash, setFlash] = useState(false);
  const [count, setCount] = useState(0);

  // ---- capture a real frame + blob and store it --------------------------
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
            setTimeout(() => setFlash(false), 120);
          }
          dwellStartRef.current = null;
          setDwell(0);
          setTimeout(() => (capturingRef.current = false), 350);
        },
        'image/jpeg',
        0.9,
      );
    },
    [store],
  );

  // ---- start: request permissions on the user gesture (iOS needs this) ----
  const start = useCallback(async () => {
    setError(null);
    try {
      // Camera
      const stream = await navigator.mediaDevices
        .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false })
        .catch(() => navigator.mediaDevices.getUserMedia({ video: true, audio: false }));
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      // Orientation (iOS 13+ gate)
      const D = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
      if (typeof D?.requestPermission === 'function') {
        try {
          await D.requestPermission();
        } catch {
          /* guidance optional */
        }
      }
      setStarted(true);
    } catch (err) {
      setError(`Could not access the camera: ${(err as Error).message}`);
    }
  }, []);

  // ---- orientation ---------------------------------------------------------
  useEffect(() => {
    if (!started) return;
    const onOrientation = (e: DeviceOrientationEvent) => {
      const raw = readAim(e);
      if (!raw) return;
      setHasCompass(true);
      if (baseYawRef.current == null) baseYawRef.current = raw.yaw; // origin = start heading
      const yaw = ((raw.yaw - baseYawRef.current) % 360 + 360) % 360;
      aimRef.current = { yaw, pitch: raw.pitch };
      setAim(aimRef.current);
    };
    window.addEventListener('deviceorientation', onOrientation, true);
    return () => window.removeEventListener('deviceorientation', onOrientation, true);
  }, [started]);

  // ---- auto-capture loop ---------------------------------------------------
  useEffect(() => {
    if (!started) return;
    let raf = 0;
    const tick = () => {
      // Nearest uncaptured target to the current aim.
      let best: { id: number; err: number } | null = null;
      for (const t of TARGETS) {
        if (capturedRef.current[t.id]) continue;
        const dYaw = angleDelta(aimRef.current.yaw, t.yaw) * Math.cos((aimRef.current.pitch * Math.PI) / 180);
        const err = Math.hypot(dYaw, t.pitch - aimRef.current.pitch);
        if (!best || err < best.err) best = { id: t.id, err };
      }
      setActiveId(best?.id ?? null);

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

  // ---- cleanup -------------------------------------------------------------
  useEffect(() => {
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  // ---- project the dots onto the screen ------------------------------------
  const dots = useMemo(() => {
    if (!hasCompass) return [];
    return TARGETS.flatMap((t) => {
      const dYaw = angleDelta(aim.yaw, t.yaw);
      const dPitch = t.pitch - aim.pitch;
      if (Math.abs(dYaw) > HALF_FOV || Math.abs(dPitch) > HALF_FOV) return [];
      return [{
        id: t.id,
        x: 50 + (dYaw / HALF_FOV) * 46,
        y: 50 - (dPitch / HALF_FOV) * 44,
        captured: !!capturedRef.current[t.id],
      }];
    });
  }, [aim, hasCompass, count]);

  const aligned = dwell > 0;

  return (
    <div className="relative h-full w-full overflow-hidden bg-black touch-none select-none">
      {/* Full-screen live camera */}
      <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" playsInline muted autoPlay />

      {/* Start gate (also satisfies the iOS motion-permission gesture) */}
      {!started && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-slate-950/95 p-6 text-center text-white">
          <h2 className="text-xl font-bold">Capture your room</h2>
          <p className="max-w-xs text-sm text-slate-400">
            Stand in one spot and slowly turn. Line up each green dot with the centre — photos are
            taken automatically.
          </p>
          <button onClick={start} className="rounded-2xl bg-indigo-500 px-8 py-3 font-semibold">
            Start capture
          </button>
          {error && <p className="text-sm text-red-300">{error}</p>}
        </div>
      )}

      {/* Floating target dots */}
      {started && dots.map((d) => (
        <div
          key={d.id}
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-75"
          style={{
            left: `${d.x}%`,
            top: `${d.y}%`,
            width: d.id === activeId ? 26 : 18,
            height: d.id === activeId ? 26 : 18,
            backgroundColor: d.captured ? 'rgba(255,255,255,0.9)' : 'rgba(34,197,94,0.9)',
            boxShadow: d.id === activeId ? '0 0 0 3px rgba(255,255,255,0.6)' : 'none',
          }}
        />
      ))}

      {/* Center white square + reticle with pie-fill dwell */}
      {started && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-[46%] w-[64%] border-2 border-white/80">
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className={`grid h-20 w-20 place-items-center rounded-full border-2 ${aligned ? 'border-green-400' : 'border-white/70'}`}>
                <div className={`h-2 w-2 rounded-full ${aligned ? 'bg-green-400' : 'bg-white/80'}`} />
                {aligned && (
                  <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 36 36">
                    <path fill="none" stroke="#4ade80" strokeWidth="3" strokeLinecap="round"
                      strokeDasharray={`${dwell * 100}, 100`}
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                  </svg>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Capture flash */}
      <div className="pointer-events-none absolute inset-0 bg-white transition-opacity duration-100" style={{ opacity: flash ? 0.6 : 0 }} />

      {/* Top HUD */}
      {started && (
        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
          <button
            onClick={() => {
              store.resetCapture();
              router.push('/');
            }}
            className="grid h-10 w-10 place-items-center rounded-full bg-white/85 text-slate-900"
            aria-label="Cancel"
          >
            ✕
          </button>
          <button
            onClick={() => {
              const ids = Object.keys(capturedRef.current).map(Number).sort((a, b) => b - a);
              if (ids.length) {
                store.removeFrame(ids[0]);
                delete capturedRef.current[ids[0]];
                setCount(Object.keys(capturedRef.current).length);
              }
            }}
            className="grid h-10 w-10 place-items-center rounded-full bg-white/85 text-slate-900"
            aria-label="Undo"
          >
            ↺
          </button>
        </div>
      )}

      {/* Bottom HUD: instruction + progress */}
      {started && (
        <div className="absolute inset-x-0 bottom-0 space-y-2 bg-gradient-to-t from-black/80 to-transparent p-4 text-white">
          <p className="text-center text-sm font-medium">
            {count === 0 ? 'Shoot all photos from the same spot to ensure an optimal result.' : 'Aim at the floating dots'}
          </p>
          <div className="flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/25">
              <div className="h-full rounded-full bg-green-500 transition-[width]" style={{ width: `${(count / 16) * 100}%` }} />
            </div>
            <span className="text-sm font-semibold tabular-nums">{count} of 16</span>
          </div>
          {!hasCompass && (
            <p className="text-center text-[11px] text-white/60">
              No motion sensor detected — dots need a phone gyroscope.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
