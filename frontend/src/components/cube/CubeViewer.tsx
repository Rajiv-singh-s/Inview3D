'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { api } from '@/lib/api';

interface SplatViewerProps {
  id: string;
}

export function CubeViewer({ id }: SplatViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Drag-to-look state
  const dragging = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  const look = useRef({ yaw: 0, pitch: 0 });

  // Joystick state
  const [joystickActive, setJoystickActive] = useState(false);
  const [joystickPos, setJoystickPos] = useState({ x: 0, y: 0 });
  const joystickStart = useRef({ x: 0, y: 0 });
  const joystickValue = useRef({ x: 0, y: 0 });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize Gaussian Splats 3D Viewer
  useEffect(() => {
    let active = true;
    let ViewerClass: any = null;

    const initViewer = async () => {
      try {
        // Dynamic import to prevent SSR issues
        const GaussianSplats3D = await import('@mkkellogg/gaussian-splats-3d');
        ViewerClass = GaussianSplats3D.Viewer;

        if (!active || !containerRef.current) return;

        const splatUrl = api.cubeSplatUrl(id);

        const viewerInstance = new ViewerClass({
          selfContained: false,
          useBuiltInControls: false, // We use our custom camera logic
          rootElement: containerRef.current,
          cameraPosition: [0, 0, 0],
          cameraLookAt: [0, 0, -1],
          showZeroPLYSplatCount: false,
          halfPrecisionCovariancesOnGPU: false, // Ensure maximum compatibility
        });

        viewerRef.current = viewerInstance;

        await viewerInstance.init();
        await viewerInstance.loadFile(splatUrl);
        
        if (!active) {
          viewerInstance.dispose();
          return;
        }

        viewerInstance.start();
        setLoading(false);

        // Frame rendering loop to update camera position/rotation
        const speed = 0.08;
        const tick = () => {
          if (!viewerRef.current) return;

          const camera = viewerRef.current.camera;
          if (camera) {
            // 1. Update Rotation from look values
            const euler = new THREE.Euler(
              THREE.MathUtils.degToRad(look.current.pitch),
              THREE.MathUtils.degToRad(-look.current.yaw),
              0,
              'YXZ'
            );
            camera.quaternion.setFromEuler(euler);

            // 2. Update Position from Joystick values
            if (joystickValue.current.x !== 0 || joystickValue.current.y !== 0) {
              const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
              const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);

              // Constrain to flat ground navigation (y=0) so user doesn't fly/sink
              forward.y = 0;
              forward.normalize();
              right.y = 0;
              right.normalize();

              camera.position.addScaledVector(forward, joystickValue.current.y * speed);
              camera.position.addScaledVector(right, joystickValue.current.x * speed);
            }
          }

          animationFrameRef.current = requestAnimationFrame(tick);
        };
        animationFrameRef.current = requestAnimationFrame(tick);
      } catch (err) {
        console.error(err);
        setError('Failed to initialize 3D Gaussian Splat viewer.');
        setLoading(false);
      }
    };

    initViewer();

    return () => {
      active = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (viewerRef.current) {
        try {
          viewerRef.current.dispose();
        } catch (e) {
          // ignore
        }
      }
    };
  }, [id]);

  // Pointer drag to look around
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.joystick-container')) return;
    dragging.current = true;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    containerRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPointer.current.x;
    const dy = e.clientY - lastPointer.current.y;
    lastPointer.current = { x: e.clientX, y: e.clientY };

    look.current.yaw = (look.current.yaw - dx * 0.15 + 360) % 360;
    look.current.pitch = Math.max(-85, Math.min(85, look.current.pitch + dy * 0.15));
  };

  const onPointerUp = () => {
    dragging.current = false;
  };

  // Joystick Events
  const handleJoystickStart = (e: React.PointerEvent) => {
    e.stopPropagation();
    setJoystickActive(true);
    const rect = e.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    joystickStart.current = { x: centerX, y: centerY };
    setJoystickPos({ x: 0, y: 0 });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleJoystickMove = (e: React.PointerEvent) => {
    if (!joystickActive) return;
    e.stopPropagation();
    
    const maxRadius = 45; // Max knob offset in pixels
    const dx = e.clientX - joystickStart.current.x;
    const dy = e.clientY - joystickStart.current.y;
    const distance = Math.hypot(dx, dy);

    if (distance === 0) {
      setJoystickPos({ x: 0, y: 0 });
      joystickValue.current = { x: 0, y: 0 };
      return;
    }

    const angle = Math.atan2(dy, dx);
    const clampedDist = Math.min(maxRadius, distance);
    const x = clampedDist * Math.cos(angle);
    const y = clampedDist * Math.sin(angle);

    setJoystickPos({ x, y });
    
    // Set speed scalar between -1 and 1
    joystickValue.current = {
      x: x / maxRadius,
      y: -y / maxRadius, // Flip Y for standard camera movement
    };
  };

  const handleJoystickEnd = (e: React.PointerEvent) => {
    e.stopPropagation();
    setJoystickActive(false);
    setJoystickPos({ x: 0, y: 0 });
    joystickValue.current = { x: 0, y: 0 };
  };

  const toggleFullscreen = () => {
    const el = document.querySelector('#splat-shell');
    if (!document.fullscreenElement) (el as HTMLElement)?.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  if (error) {
    return (
      <div className="flex h-[75vh] w-full flex-col items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center">
        <p className="font-semibold text-red-300">Viewer Error</p>
        <p className="mt-1 text-sm text-slate-400">{error}</p>
      </div>
    );
  }

  return (
    <div
      id="splat-shell"
      className="relative h-[75vh] w-full touch-none select-none overflow-hidden rounded-2xl border border-slate-800 bg-[#0b0d12]"
    >
      {/* 3DGS Canvas Container */}
      <div
        ref={containerRef}
        className="absolute inset-0 h-full w-full outline-none cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-t-green-400 border-white/20" />
          <p className="mt-3 text-sm font-medium text-slate-200">Downloading 3D World...</p>
        </div>
      )}

      {/* Controller HUD */}
      {!loading && (
        <>
          {/* Virtual Joystick for navigation */}
          <div className="joystick-container absolute bottom-6 left-6 z-20 flex h-[110px] w-[110px] items-center justify-center rounded-full border border-white/10 bg-white/5 backdrop-blur-md">
            <div
              className="relative flex h-[100px] w-[100px] cursor-pointer items-center justify-center rounded-full"
              onPointerDown={handleJoystickStart}
              onPointerMove={handleJoystickMove}
              onPointerUp={handleJoystickEnd}
            >
              {/* Knob */}
              <div
                className="absolute h-9 w-9 rounded-full bg-green-500 border border-white/20 shadow-lg transition-transform duration-75 flex items-center justify-center"
                style={{
                  transform: `translate(${joystickPos.x}px, ${joystickPos.y}px)`,
                  boxShadow: '0 0 15px rgba(34, 197, 94, 0.4)',
                }}
              >
                <div className="h-3 w-3 rounded-full bg-white/40" />
              </div>
            </div>
          </div>

          {/* HUD buttons */}
          <div className="pointer-events-auto absolute right-3 top-3 z-20 flex gap-2">
            <button
              onClick={toggleFullscreen}
              className="rounded-lg bg-slate-900/80 px-3 py-1.5 text-xs font-semibold text-white border border-white/10 backdrop-blur hover:bg-slate-800"
            >
              Fullscreen
            </button>
          </div>

          <p className="pointer-events-none absolute bottom-4 left-0 right-0 z-10 text-center text-[10px] text-white/50">
            Drag to look around · Use Joystick to walk
          </p>
        </>
      )}
    </div>
  );
}
