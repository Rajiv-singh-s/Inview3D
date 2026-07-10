'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, useTexture } from '@react-three/drei';
import * as THREE from 'three';

/** 90° feels immersive; 30–120 covers zoomed-in to very wide. */
const DEFAULT_FOV = 90;
const MIN_FOV = 30;
const MAX_FOV = 120;

interface Look { lon: number; lat: number; }

/**
 * Equirectangular panorama rendered on the inside of a sphere — the Street
 * View model. Camera is driven by direct yaw/pitch (not OrbitControls), zoom
 * by FOV change, which keeps straight lines straight.
 */
function Sphere({ url }: { url: string }) {
  const texture = useTexture(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.RepeatWrapping;
  return (
    <mesh>
      <sphereGeometry args={[500, 128, 64]} />
      <meshBasicMaterial map={texture} side={THREE.BackSide} toneMapped={false} />
    </mesh>
  );
}

function CameraRig({ look, fov }: { look: React.RefObject<Look>; fov: React.MutableRefObject<number> }) {
  const { camera } = useThree();
  useFrame(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const target = fov.current;
    if (Math.abs(cam.fov - target) > 0.1) {
      cam.fov += (target - cam.fov) * 0.15;
      cam.updateProjectionMatrix();
    }
    const { lon, lat } = look.current;
    const phi = THREE.MathUtils.degToRad(90 - lat);
    const theta = THREE.MathUtils.degToRad(lon);
    camera.lookAt(
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta),
    );
  });
  return null;
}

function LoadingHint() {
  return (
    <Html center>
      <div className="rounded-lg bg-slate-900/80 px-4 py-2 text-sm text-slate-200">
        Loading photosphere…
      </div>
    </Html>
  );
}

export function PhotosphereViewer({ url }: { url: string }) {
  const look = useRef<Look>({ lon: 0, lat: 0 });
  const fovRef = useRef<number>(DEFAULT_FOV);
  const [, forceUpdate] = useState(0);
  const dragging = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  const lastPinchDist = useRef(0);
  const lastTouchCount = useRef(0);

  const setFov = useCallback((v: number) => {
    fovRef.current = THREE.MathUtils.clamp(v, MIN_FOV, MAX_FOV);
    forceUpdate((n) => n + 1);
  }, []);

  const zoomBy = useCallback((delta: number) => {
    setFov(fovRef.current + delta);
  }, [setFov]);

  const reset = useCallback(() => {
    look.current = { lon: 0, lat: 0 };
    setFov(DEFAULT_FOV);
  }, [setFov]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' && lastTouchCount.current > 1) return;
    dragging.current = true;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    if (e.pointerType === 'touch' && lastTouchCount.current > 1) return;
    const dx = e.clientX - lastPointer.current.x;
    const dy = e.clientY - lastPointer.current.y;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    const shell = (e.target as HTMLElement).closest('#photosphere-shell') as HTMLElement;
    const w = shell?.clientWidth ?? 800;
    const speed = fovRef.current / w;
    look.current.lon -= dx * speed;
    look.current.lat = THREE.MathUtils.clamp(look.current.lat + dy * speed * 0.9, -85, 85);
  };

  const endDrag = () => { dragging.current = false; };

  const onTouchStart = (e: React.TouchEvent) => {
    lastTouchCount.current = e.touches.length;
    if (e.touches.length === 2) {
      dragging.current = false;
      lastPinchDist.current = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    lastTouchCount.current = e.touches.length;
    if (e.touches.length === 2) {
      dragging.current = false;
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      zoomBy((lastPinchDist.current - dist) * 0.1);
      lastPinchDist.current = dist;
    }
  };

  const onWheel = (e: React.WheelEvent) => { zoomBy(e.deltaY * 0.02); };

  const toggleFullscreen = () => {
    const el = document.querySelector('#photosphere-shell');
    if (!document.fullscreenElement) (el as HTMLElement)?.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const step = fovRef.current / 15;
      if (e.key === 'ArrowLeft') look.current.lon -= step;
      else if (e.key === 'ArrowRight') look.current.lon += step;
      else if (e.key === 'ArrowUp')
        look.current.lat = THREE.MathUtils.clamp(look.current.lat + step, -85, 85);
      else if (e.key === 'ArrowDown')
        look.current.lat = THREE.MathUtils.clamp(look.current.lat - step, -85, 85);
      else if (e.key === '+' || e.key === '=') zoomBy(-5);
      else if (e.key === '-') zoomBy(5);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomBy]);

  const Btn = ({ onClick, label }: { onClick: () => void; label: string }) => (
    <button
      onClick={onClick}
      className="rounded-lg bg-slate-900/70 px-3 py-1.5 text-xs font-medium text-white backdrop-blur hover:bg-slate-800"
    >
      {label}
    </button>
  );

  return (
    <div
      id="photosphere-shell"
      className="relative h-[75vh] w-full select-none overflow-hidden rounded-2xl border border-slate-800 bg-black"
      style={{ cursor: 'grab', touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onPointerCancel={endDrag}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onWheel={onWheel}
    >
      <Canvas
        camera={{ fov: DEFAULT_FOV, position: [0, 0, 0.001], near: 0.1, far: 1100 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
      >
        <Suspense fallback={<LoadingHint />}>
          <Sphere url={url} />
        </Suspense>
        <CameraRig look={look} fov={fovRef} />
      </Canvas>

      <div className="pointer-events-auto absolute right-3 top-3 flex flex-wrap justify-end gap-2">
        <Btn onClick={() => zoomBy(-10)} label="Zoom +" />
        <Btn onClick={() => zoomBy(10)} label="Zoom −" />
        <Btn onClick={reset} label="Reset" />
        <Btn onClick={toggleFullscreen} label="⛶" />
      </div>

      <div className="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-xs text-white/50">
        Drag to look · Scroll / pinch to zoom · Arrow keys to pan
      </div>
    </div>
  );
}
