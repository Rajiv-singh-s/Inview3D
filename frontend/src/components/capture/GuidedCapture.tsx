'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface Target {
  face: string;
  yaw: number;
  pitch: number;
  label: string;
}

function buildCubemapTargets(): Target[] {
  return [
    // FRONT
    { face: 'front', yaw: -20, pitch: 0, label: 'FRONT LEFT' },
    { face: 'front', yaw: 0, pitch: 0, label: 'FRONT CENTER' },
    { face: 'front', yaw: 20, pitch: 0, label: 'FRONT RIGHT' },
    
    // RIGHT
    { face: 'right', yaw: 70, pitch: 0, label: 'RIGHT LEFT' },
    { face: 'right', yaw: 90, pitch: 0, label: 'RIGHT CENTER' },
    { face: 'right', yaw: 110, pitch: 0, label: 'RIGHT RIGHT' },
    
    // BACK
    { face: 'back', yaw: 160, pitch: 0, label: 'BACK LEFT' },
    { face: 'back', yaw: 180, pitch: 0, label: 'BACK CENTER' },
    { face: 'back', yaw: -160, pitch: 0, label: 'BACK RIGHT' },
    
    // LEFT
    { face: 'left', yaw: -110, pitch: 0, label: 'LEFT LEFT' },
    { face: 'left', yaw: -90, pitch: 0, label: 'LEFT CENTER' },
    { face: 'left', yaw: -70, pitch: 0, label: 'LEFT RIGHT' },
    
    // TOP (CEILING)
    { face: 'top', yaw: -20, pitch: 75, label: 'CEILING LEFT' },
    { face: 'top', yaw: 0, pitch: 75, label: 'CEILING CENTER' },
    { face: 'top', yaw: 20, pitch: 75, label: 'CEILING RIGHT' },
    
    // BOTTOM (FLOOR)
    { face: 'bottom', yaw: -20, pitch: -75, label: 'FLOOR LEFT' },
    { face: 'bottom', yaw: 0, pitch: -75, label: 'FLOOR CENTER' },
    { face: 'bottom', yaw: 20, pitch: -75, label: 'FLOOR RIGHT' },
  ];
}

export const TOTAL_SHOTS = 18;

export interface CapturedShot {
  blob: Blob;
  face: string;
  yaw: number;
  pitch: number;
}

interface GuidedCaptureProps {
  shots: CapturedShot[];
  onShot: (shot: CapturedShot) => void;
  onUndo: () => void;
  onFinish: () => void;
  onCancel: () => void;
  busy?: boolean;
  uploadProgress?: number;
}

export function GuidedCapture({
  shots,
  onShot,
  onUndo,
  onFinish,
  onCancel,
  busy,
  uploadProgress = 0,
}: GuidedCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const capturingRef = useRef(false);
  const targets = useMemo(buildCubemapTargets, []);
  
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [flash, setFlash] = useState(false);
  const [capturePhase, setCapturePhase] = useState<'capturing' | 'review'>('capturing');
  const [isPortrait, setIsPortrait] = useState(true);

  const count = shots.length;

  // Auto transition to review phase when done
  useEffect(() => {
    if (count === TOTAL_SHOTS && capturePhase === 'capturing') {
      setCapturePhase('review');
    }
  }, [count, capturePhase]);

  // ---- Orientation Check --------------------------------------------------
  useEffect(() => {
    const checkOrientation = () => {
      setIsPortrait(window.innerHeight > window.innerWidth);
    };
    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);
    return () => {
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
    };
  }, []);

  // ---- Camera Device Selection (Widest / 0.5x) -----------------------------
  const getWideCameraId = async (): Promise<string | null> => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      const backCameras = videoDevices.filter(d => 
        d.label.toLowerCase().includes('back') || 
        d.label.toLowerCase().includes('environment') ||
        d.label.toLowerCase().includes('rear')
      );

      if (backCameras.length > 0) {
        const ultraWide = backCameras.find(d => 
          d.label.toLowerCase().includes('ultra') || 
          d.label.toLowerCase().includes('0.5') ||
          d.label.toLowerCase().includes('wide')
        );
        if (ultraWide) return ultraWide.deviceId;
        if (backCameras.length > 1) return backCameras[1].deviceId;
        return backCameras[0].deviceId;
      }
      return null;
    } catch {
      return null;
    }
  };

  // ---- Initialize Camera Stream -------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let stream: MediaStream;
        const deviceId = await getWideCameraId();
        
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: deviceId 
              ? { deviceId: { exact: deviceId }, width: { ideal: 1920 } }
              : { 
                  facingMode: { ideal: 'environment' }, 
                  width: { ideal: 1920 },
                  // @ts-ignore
                  focusMode: 'continuous',
                  zoom: { ideal: 0.5 } 
                } as any,
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
            audio: false,
          });
        }
        
        const track = stream.getVideoTracks()[0];
        try {
           const capabilities = track.getCapabilities() as any;
           const constraints: any = { advanced: [{}] };
           if (capabilities.focusMode?.includes('single-shot')) constraints.advanced[0].focusMode = 'single-shot';
           if (capabilities.exposureMode?.includes('manual')) constraints.advanced[0].exposureMode = 'manual';
           if (Object.keys(constraints.advanced[0]).length > 0) {
             await track.applyConstraints(constraints);
           }
        } catch (e) {
           // Ignore constraints error
        }

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setReady(true);
      } catch (err) {
        setError(`Could not access the camera: ${(err as Error).message}.`);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const triggerFlash = useCallback(() => {
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
  }, []);

  const takeManualShot = useCallback(() => {
    const video = videoRef.current;
    if (!video || capturingRef.current || video.videoWidth === 0 || count >= TOTAL_SHOTS) return;

    capturingRef.current = true;
    const target = targets[count];

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    
    canvas.toBlob(
      (blob) => {
        if (blob) {
          // Use perfect mathematical nominal pose for zero-defect projection warping
          onShot({ 
            blob, 
            face: target.face, 
            yaw: target.yaw, 
            pitch: target.pitch 
          });
          triggerFlash();
        }
        setTimeout(() => (capturingRef.current = false), 300);
      },
      'image/jpeg',
      0.92,
    );
  }, [count, targets, onShot, triggerFlash]);

  const imageUrls = useMemo(() => shots.map((s) => URL.createObjectURL(s.blob)), [shots]);

  useEffect(() => {
    return () => imageUrls.forEach((url) => URL.revokeObjectURL(url));
  }, [imageUrls]);

  // ---- Get Current Instruction Text ---------------------------------------
  const guidance = useMemo(() => {
    if (count >= TOTAL_SHOTS) return { step: 'Finished', text: 'All shots captured! Proceed to stitch.' };
    const t = targets[count];
    const faceName = t.face.toUpperCase();
    
    let turnHint = '';
    if (count === 0) turnHint = 'Start facing the center of the FRONT wall.';
    else if (count === 3) turnHint = 'Turn 90° to the RIGHT wall.';
    else if (count === 6) turnHint = 'Turn 90° to the BACK wall.';
    else if (count === 9) turnHint = 'Turn 90° to the LEFT wall.';
    else if (count === 12) turnHint = 'Tilt your phone UP 75° to the CEILING.';
    else if (count === 15) turnHint = 'Tilt your phone DOWN 75° to the FLOOR.';

    let targetHint = '';
    if (count % 3 === 0) targetHint = 'Align with the LEFT column dot (Left Overlap).';
    else if (count % 3 === 1) targetHint = 'Align with the CENTER column dot (Face Center).';
    else if (count % 3 === 2) targetHint = 'Align with the RIGHT column dot (Right Overlap).';

    return {
      face: faceName,
      step: `Shot ${count + 1} of ${TOTAL_SHOTS}`,
      turn: turnHint,
      target: targetHint,
    };
  }, [count, targets]);

  // ========================================================================
  //  PORTRAIT ENFORCEMENT
  // ========================================================================
  if (!isPortrait) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950 p-6 text-center text-white">
        <svg className="w-16 h-16 mb-4 animate-bounce text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
        <h2 className="text-xl font-bold">Please Rotate Device</h2>
        <p className="text-slate-400 mt-2 text-sm">Capture is only supported in Portrait mode.</p>
      </div>
    );
  }

  // ========================================================================
  //  ERROR STATE
  // ========================================================================
  if (error) {
    return (
      <div className="card border-red-500/40 bg-red-500/5 p-6">
        <p className="font-medium text-red-300">Camera unavailable</p>
        <p className="mt-1 text-sm text-red-200/80">{error}</p>
        <button onClick={onCancel} className="btn-ghost mt-4">Back</button>
      </div>
    );
  }

  // ========================================================================
  //  REVIEW PHASE
  // ========================================================================
  if (capturePhase === 'review') {
    return (
      <div className="relative mx-auto w-full max-w-md overflow-hidden rounded-2xl bg-slate-950 p-4 border border-slate-800 text-white min-h-[75vh] flex flex-col justify-between">
        <div className="space-y-6 overflow-y-auto max-h-[62vh] pr-1">
          <div>
            <h2 className="text-xl font-bold">Source images ({count})</h2>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {imageUrls.map((url, idx) => (
                <div key={idx} className="relative aspect-square overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Captured ${idx}`} className="h-full w-full object-cover" />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-slate-800 pt-4 space-y-2">
          <button
            onClick={onFinish}
            disabled={busy}
            className="w-full rounded-xl bg-green-500 py-3 font-semibold text-white active:bg-green-600 disabled:opacity-40"
          >
            {busy ? `Stitching... (${uploadProgress}%)` : 'Stitch and post'}
          </button>
          <button
            onClick={() => setCapturePhase('capturing')}
            disabled={busy}
            className="w-full text-center py-2 text-sm text-slate-400 hover:text-white"
          >
            Not now
          </button>
        </div>
      </div>
    );
  }

  // ========================================================================
  //  CAPTURE PHASE
  // ========================================================================
  const activeDotIndex = count % 3;

  return (
    <div className="relative mx-auto w-full max-w-md overflow-hidden rounded-2xl bg-black">
      <video ref={videoRef} playsInline muted className="h-[85vh] w-full bg-black object-cover" />

      {/* Screen flash effect */}
      <div
        className="pointer-events-none absolute inset-0 bg-white transition-opacity duration-75"
        style={{ opacity: flash ? 0.6 : 0 }}
      />

      {/* Grid and Dots Overlay */}
      <div className="pointer-events-none absolute inset-0">
        
        {/* Visual guide layout (matches user hand-drawn diagram) */}
        <div className="absolute inset-0">
          {/* Vertical Column Lines */}
          <div className="absolute left-[33.33%] top-0 bottom-0 border-l border-white/20 border-dashed" />
          <div className="absolute left-[66.66%] top-0 bottom-0 border-l border-white/20 border-dashed" />
          
          {/* Horizontal Bounds */}
          <div className="absolute top-[18%] left-0 right-0 border-t border-white/20 border-dashed" />
          <div className="absolute bottom-[18%] left-0 right-0 border-t border-white/20 border-dashed" />

          {/* Boundaries labels */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[10px] font-bold tracking-widest text-white/30">UP / CEILING</div>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-bold tracking-widest text-white/30">DOWN / FLOOR</div>
          <div className="absolute left-2 top-[30%] text-[10px] font-bold tracking-widest text-white/30 vertical-text" style={{ writingMode: 'vertical-lr' }}>LEFT OVERLAP</div>
          <div className="absolute right-2 top-[30%] text-[10px] font-bold tracking-widest text-white/30 vertical-text" style={{ writingMode: 'vertical-lr' }}>RIGHT OVERLAP</div>
        </div>

        {/* Static targets: Left, Center, Right dots */}
        <div className="absolute inset-0 flex justify-between items-center px-[10%]">
          {[0, 1, 2].map((idx) => {
            const isActive = activeDotIndex === idx;
            const label = idx === 0 ? 'LEFT' : idx === 1 ? 'CENTER' : 'RIGHT';
            return (
              <div 
                key={idx} 
                className="flex flex-col items-center justify-center space-y-2"
                style={{
                  width: '60px',
                }}
              >
                <div
                  className={`rounded-full transition-all duration-300 ${
                    isActive 
                      ? 'w-10 h-10 bg-green-500 border-4 border-white shadow-[0_0_15px_rgba(34,197,94,0.8)] scale-110' 
                      : 'w-7 h-7 bg-white/30 border-2 border-white/20 scale-100'
                  }`}
                />
                <span 
                  className={`text-[9px] font-bold tracking-wider ${
                    isActive ? 'text-green-400' : 'text-white/40'
                  }`}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Floating guidance banner */}
        <div className="absolute left-1/2 top-4 w-[90%] -translate-x-1/2 rounded-xl bg-slate-950/80 backdrop-blur-md px-4 py-3 text-center border border-slate-800">
          <div className="text-xs font-bold uppercase tracking-wider text-green-400">{guidance.face} FACE</div>
          <div className="text-[10px] text-white/50">{guidance.step}</div>
          {guidance.turn && (
            <div className="mt-1.5 text-sm font-semibold text-white leading-tight animate-pulse">{guidance.turn}</div>
          )}
          {guidance.target && (
            <div className="mt-1 text-xs text-slate-300">{guidance.target}</div>
          )}
        </div>
      </div>

      {/* Control Buttons */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3 pointer-events-none mt-24">
        {/* Undo button */}
        <button
          onClick={onUndo}
          disabled={count === 0 || busy}
          className="pointer-events-auto grid h-10 w-10 place-items-center rounded-full bg-slate-950/70 border border-slate-800 text-white disabled:opacity-30 active:scale-95 transition-transform"
          aria-label="Undo last shot"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
        </button>

        {/* Cancel button */}
        <button
          onClick={onCancel}
          className="pointer-events-auto grid h-10 w-10 place-items-center rounded-full bg-red-500/80 border border-red-600 text-white active:scale-95 transition-transform"
          aria-label="Cancel capture"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Capture bottom tray */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent p-4 pt-12 space-y-4">
        
        {/* Progress bar */}
        <div className="flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-green-500 transition-[width] duration-300"
              style={{ width: `${(count / TOTAL_SHOTS) * 100}%` }}
            />
          </div>
          <span className="min-w-[5ch] text-right text-xs font-semibold tabular-nums text-white">
            {count}/{TOTAL_SHOTS}
          </span>
        </div>

        {/* Action button row */}
        <div className="flex items-center justify-between gap-4">
          
          <button
            onClick={() => setCapturePhase('review')}
            disabled={count < 4 || busy}
            className="flex-1 rounded-xl bg-slate-800/80 border border-slate-700/50 py-3 font-semibold text-slate-300 disabled:opacity-40 disabled:pointer-events-none active:bg-slate-700 text-xs"
          >
            Finish Early ({count})
          </button>

          {/* Center main shutter button */}
          <div className="flex-1 flex justify-center">
            <button
              onClick={takeManualShot}
              disabled={busy || count >= TOTAL_SHOTS}
              className="w-16 h-16 rounded-full bg-white border-4 border-slate-800 shadow-2xl flex items-center justify-center disabled:opacity-40 active:scale-90 transition-transform"
              aria-label="Capture Photo"
            >
              <div className="w-12 h-12 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
            </button>
          </div>

          <div className="flex-1" />
        </div>
      </div>
    </div>
  );
}
