'use client';

import React, { useEffect, useRef, useState } from 'react';
import { CameraController } from '@/engine/CameraController';
import { FrameRingBuffer } from '@/engine/FrameRingBuffer';
import { OrientationTracker, OrientationUpdate } from '@/engine/OrientationTracker';
import { MotionGate } from '@/engine/MotionGate';
import { VisualTracker } from '@/engine/VisualTracker';
import { ViewportMaskShader } from '@/engine/ViewportMaskShader';
import { nearestUncaptured } from '@/engine/SphereTargets';
import { useCaptureStore } from '@/store/captureStore';
import { TargetOverlay } from './TargetOverlay';
import { StitchPreview } from './StitchPreview';
import { AlignmentRing } from './AlignmentRing';
import { CaptureHUD } from './CaptureHUD';
import { useRouter } from 'next/navigation';

/**
 * The core orchestration component for the Capture phase.
 * Manages engine lifecycle, camera feed, WebGL masking, and the automated capture loop.
 */
export const CaptureViewport: React.FC = () => {
  const router = useRouter();
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const store = useCaptureStore();
  const capturedIds = new Set(Object.keys(store.capturedFrames).map(Number));
  
  const [activeTargetId, setActiveTargetId] = useState<number | null>(null);
  const [currentAim, setCurrentAim] = useState({ yaw: 0, pitch: 0 });
  const [isStable, setIsStable] = useState(false);
  const [isAligned, setIsAligned] = useState(false);
  const [dwellProgress, setDwellProgress] = useState(0);
  const [isCapturedFlash, setIsCapturedFlash] = useState(false);
  
  const logicRefs = useRef({
    cameraController: new CameraController(),
    ringBuffer: new FrameRingBuffer(30),
    motionGate: new MotionGate(0.8, 0.2),
    visualTracker: new VisualTracker(),
    orientationTracker: null as OrientationTracker | null,
    maskShader: null as ViewportMaskShader | null,
    animationFrameId: null as number | null,
    dwellStart: 0,
    currentAim: { yaw: 0, pitch: 0 },
    activeTargetId: null as number | null,
    capturedSet: {} as Record<number, boolean>,
  });

  useEffect(() => {
    Object.keys(store.capturedFrames).forEach(id => {
      logicRefs.current.capturedSet[Number(id)] = true;
    });
  }, [store.capturedFrames]);

  useEffect(() => {
    let isMounted = true;
    const init = async () => {
      try {
        const refs = logicRefs.current;
        await refs.cameraController.init();
        
        const stream = refs.cameraController.getStream();
        if (stream && videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(console.warn);
          
          const track = stream.getVideoTracks()[0];
          await refs.ringBuffer.start(track);
        }

        if (canvasRef.current) {
          canvasRef.current.width = window.innerWidth;
          canvasRef.current.height = window.innerHeight;
          refs.maskShader = new ViewportMaskShader(canvasRef.current);
        }

        refs.orientationTracker = new OrientationTracker((update: OrientationUpdate) => {
          if (!isMounted) return;
          refs.currentAim = { yaw: update.yaw, pitch: update.pitch };
          setCurrentAim(refs.currentAim);
        });
        
        await refs.orientationTracker.start();

        const loop = () => {
          if (!isMounted) return;
          refs.animationFrameId = requestAnimationFrame(loop);
          
          if (videoRef.current && refs.maskShader) {
            refs.maskShader.render(videoRef.current, [-0.8, -0.8, 1.6, 1.6]); // NDC rect
          }

          const stable = refs.motionGate.isStable();
          setIsStable(stable);

          const nearest = nearestUncaptured(refs.currentAim, refs.capturedSet);
          if (nearest) {
            if (refs.activeTargetId !== nearest.id) {
              refs.activeTargetId = nearest.id;
              setActiveTargetId(nearest.id);
            }
            
            const aligned = nearest.angularError < 6.0; // 6 degrees threshold
            if (isAligned !== aligned) setIsAligned(aligned);

            if (stable && aligned) {
              if (refs.dwellStart === 0) {
                refs.dwellStart = performance.now();
              }
              const progress = (performance.now() - refs.dwellStart) / 500; // 500ms dwell required
              setDwellProgress(Math.min(1, progress));

              if (progress >= 1) {
                captureFrame(nearest.id);
                refs.dwellStart = 0;
              }
            } else {
              refs.dwellStart = 0;
              setDwellProgress(0);
            }
          } else {
            if (refs.activeTargetId !== null) {
              refs.activeTargetId = null;
              setActiveTargetId(null);
            }
          }
        };
        
        loop();

      } catch (err) {
        console.error('Initialization error:', err);
      }
    };

    init();

    return () => {
      isMounted = false;
      const refs = logicRefs.current;
      if (refs.animationFrameId) cancelAnimationFrame(refs.animationFrameId);
      refs.orientationTracker?.stop();
      refs.ringBuffer.stop();
      refs.visualTracker.destroy();
      refs.motionGate.destroy();
      refs.maskShader?.dispose();
      refs.cameraController.destroy();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const captureFrame = (targetId: number) => {
    // Account for human/device delay by grabbing an older frame
    const frameData = logicRefs.current.ringBuffer.getFrameAgo(150);
    let blobUrl = '';
    
    if (frameData && frameData instanceof HTMLCanvasElement) {
      blobUrl = frameData.toDataURL('image/jpeg', 0.8);
    } else if (frameData && 'close' in frameData) {
      const cvs = document.createElement('canvas');
      cvs.width = frameData.displayWidth;
      cvs.height = frameData.displayHeight;
      const ctx = cvs.getContext('2d');
      if (ctx) {
        ctx.drawImage(frameData as any, 0, 0);
        blobUrl = cvs.toDataURL('image/jpeg', 0.8);
      }
      frameData.close();
    }
    
    setIsCapturedFlash(true);
    setTimeout(() => setIsCapturedFlash(false), 200);

    store.addFrame({
      targetId,
      thumbnailUrl: blobUrl,
      pose: { yaw: logicRefs.current.currentAim.yaw, pitch: logicRefs.current.currentAim.pitch, roll: 0, timestamp: Date.now() },
      blob: null as any,
      sharpness: 1
    });
    
    logicRefs.current.capturedSet[targetId] = true;
    logicRefs.current.dwellStart = 0;
  };

  const handleCancel = () => {
    store.resetCapture();
    router.push('/'); 
  };

  const handleReview = () => {
    // This could force the router into the review state manually
    // Or it could be handled by the parent page based on the store
    router.push('/review');
  };

  return (
    <div className="relative w-full h-full bg-slate-950 overflow-hidden">
      <video ref={videoRef} className="hidden" playsInline muted autoPlay />
      
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full z-0" />

      <TargetOverlay activeTargetId={activeTargetId} capturedIds={capturedIds} currentAim={currentAim} />
      <StitchPreview />
      
      <AlignmentRing dwellProgress={dwellProgress} isAligned={isAligned} isCaptured={isCapturedFlash} />
      
      <CaptureHUD 
        onCancel={handleCancel} 
        onReview={handleReview} 
        isStable={isStable} 
      />
    </div>
  );
};
