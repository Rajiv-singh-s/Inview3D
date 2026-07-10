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
  onShot: (shot: CapturedShot | CapturedShot[]) => void;
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

  // Auto transition to review phase when all 18 shots (6 faces * 3 slices) are captured
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

  // ---- Capture Face & Automatically Crop Into 3 Equal Vertical Frames -----
  const takeManualShot = useCallback(() => {
    const video = videoRef.current;
    if (!video || capturingRef.current || video.videoWidth === 0 || count >= TOTAL_SHOTS) return;

    capturingRef.current = true;

    // 6 Faces: Front, Right, Back, Left, Top, Bottom
    const currentFaceIndex = Math.floor(count / 3);
    const faces = ['front', 'right', 'back', 'left', 'top', 'bottom'];
    const currentFace = faces[currentFaceIndex];

    let nominalPitch = 0;
    if (currentFace === 'top') nominalPitch = 75;
    if (currentFace === 'bottom') nominalPitch = -75;

    const w_full = video.videoWidth;
    const h_full = video.videoHeight;
    const w_panel = Math.floor(w_full / 3);

    // Extract a vertical slice from the video canvas
    const extractSlice = (xStart: number): Promise<Blob | null> => {
      const canvas = document.createElement('canvas');
      canvas.width = w_panel;
      canvas.height = h_full;
      const ctx = canvas.getContext('2d');
      if (!ctx) return Promise.resolve(null);

      // Slice the input frame vertically
      ctx.drawImage(
        video,
        xStart, 0, w_panel, h_full, // Source region
        0, 0, w_panel, h_full       // Target region
      );

      return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92);
      });
    };

    // Crop Left, Middle, and Right sections of the single snapshot simultaneously
    Promise.all([
      extractSlice(0),             // Left 1/3 panel
      extractSlice(w_panel),       // Middle 1/3 panel
      extractSlice(2 * w_panel)    // Right 1/3 panel
    ]).then(([leftBlob, middleBlob, rightBlob]) => {
      if (leftBlob && middleBlob && rightBlob) {
        let baseYaw = 0;
        if (currentFace === 'front') baseYaw = 0;
        else if (currentFace === 'right') baseYaw = 90;
        else if (currentFace === 'back') baseYaw = 180;
        else if (currentFace === 'left') baseYaw = -90;
        else if (currentFace === 'top') baseYaw = 0;
        else if (currentFace === 'bottom') baseYaw = 0;

        const leftYaw = baseYaw - 20;
        const middleYaw = baseYaw;
        const rightYaw = baseYaw + 20;

        const newShots: CapturedShot[] = [
          { blob: leftBlob, face: currentFace, yaw: leftYaw, pitch: nominalPitch },
          { blob: middleBlob, face: currentFace, yaw: middleYaw, pitch: nominalPitch },
          { blob: rightBlob, face: currentFace, yaw: rightYaw, pitch: nominalPitch }
        ];

        onShot(newShots);
        triggerFlash();
      }
      setTimeout(() => {
        capturingRef.current = false;
      }, 400);
    }).catch((err) => {
      console.error(err);
      capturingRef.current = false;
    });

  }, [count, onShot, triggerFlash]);

  const imageUrls = useMemo(() => shots.map((s) => URL.createObjectURL(s.blob)), [shots]);

  useEffect(() => {
    return () => imageUrls.forEach((url) => URL.revokeObjectURL(url));
  }, [imageUrls]);

  // ---- Get Current Instruction Text ---------------------------------------
  const guidance = useMemo(() => {
    const currentFaceIndex = Math.floor(count / 3);
    const faces = ['FRONT', 'RIGHT', 'BACK', 'LEFT', 'CEILING', 'FLOOR'];
    
    if (currentFaceIndex >= 6) {
      return { step: 'Finished', text: 'All faces captured! Proceed to stitch.' };
    }
    
    const faceName = faces[currentFaceIndex];
    
    let turnHint = '';
    if (currentFaceIndex === 0) turnHint = 'Aim directly at the center of the FRONT wall.';
    else if (currentFaceIndex === 1) turnHint = 'Turn 90° right, aim at the center of the RIGHT wall.';
    else if (currentFaceIndex === 2) turnHint = 'Turn 90° right, aim at the center of the BACK wall.';
    else if (currentFaceIndex === 3) turnHint = 'Turn 90° right, aim at the center of the LEFT wall.';
    else if (currentFaceIndex === 4) turnHint = 'Tilt phone UP 75°, aim at the center of the CEILING.';
    else if (currentFaceIndex === 5) turnHint = 'Tilt phone DOWN 75°, aim at the center of the FLOOR.';

    return {
      face: faceName,
      step: `Face ${currentFaceIndex + 1} of 6`,
      turn: turnHint,
      target: 'Align and press the capture button. The app will automatically split it into 3 equal panels.',
    };
  }, [count]);

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
          <div className="absolute left-[33.33%] top-0 bottom-0 border-l border-white/25 border-dashed" />
          <div className="absolute left-[66.66%] top-0 bottom-0 border-l border-white/25 border-dashed" />
          
          {/* Horizontal Bounds */}
          <div className="absolute top-[18%] left-0 right-0 border-t border-white/25 border-dashed" />
          <div className="absolute bottom-[18%] left-0 right-0 border-t border-white/25 border-dashed" />

          {/* Boundaries labels */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[10px] font-bold tracking-widest text-white/30">UP / CEILING</div>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-bold tracking-widest text-white/30">DOWN / FLOOR</div>
          <div className="absolute left-2 top-[30%] text-[10px] font-bold tracking-widest text-white/30 vertical-text" style={{ writingMode: 'vertical-lr' }}>LEFT OVERLAP</div>
          <div className="absolute right-2 top-[30%] text-[10px] font-bold tracking-widest text-white/30 vertical-text" style={{ writingMode: 'vertical-lr' }}>RIGHT OVERLAP</div>
        </div>

        {/* Static targets: Left, Center, Right dots */}
        <div className="absolute inset-0 flex justify-between items-center px-[10%]">
          {[0, 1, 2].map((idx) => {
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
                  className="w-10 h-10 bg-green-500 border-4 border-white shadow-[0_0_15px_rgba(34,197,94,0.8)] animate-pulse rounded-full"
                />
                <span className="text-[9px] font-bold tracking-wider text-green-400">
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
            <div className="mt-1 text-[11px] text-slate-300 leading-normal">{guidance.target}</div>
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
            disabled={count < 3 || busy}
            className="flex-1 rounded-xl bg-slate-800/80 border border-slate-700/50 py-3 font-semibold text-slate-300 disabled:opacity-40 disabled:pointer-events-none active:bg-slate-700 text-xs"
          >
            Review ({count})
          </button>

          {/* Center main shutter button */}
          <div className="flex-1 flex justify-center">
            <button
              onClick={takeManualShot}
              disabled={busy || count >= TOTAL_SHOTS}
              className="w-16 h-16 rounded-full bg-white border-4 border-slate-800 shadow-2xl flex items-center justify-center disabled:opacity-40 active:scale-90 transition-transform pointer-events-auto"
              aria-label="Capture Photo"
            >
              <div className="w-12 h-12 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center pointer-events-none">
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
