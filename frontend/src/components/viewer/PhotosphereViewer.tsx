'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { api } from '@/lib/api';

/** 90° feels immersive; 30–120 covers zoomed-in to very wide. */
const DEFAULT_FOV = 90;
const MIN_FOV = 30;
const MAX_FOV = 120;

interface Look { lon: number; lat: number; }

/**
 * Cubemap panorama rendered on the inside of a box.
 */
function Cubemap({ id }: { id: string }) {
  const faces = ['right', 'left', 'top', 'bottom', 'front', 'back'];
  
  // Use Drei's useTexture to load all 6 textures concurrently
  const textures = useTexture(faces.map(face => api.panoramaFaceUrl(id, face)));

  textures.forEach((texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
  });

  return (
    <mesh>
      {/* 
        A box of size 500. We invert the scale on X so that we are inside the box 
        and textures map correctly.
      */}
      <boxGeometry args={[500, 500, 500]} />
      {textures.map((texture, index) => (
        <meshBasicMaterial key={index} attach={`material-${index}`} map={texture} side={THREE.BackSide} toneMapped={false} />
      ))}
    </mesh>
  );
}

function CameraRig({
  look,
  fov,
  joystick,
}: {
  look: React.RefObject<Look>;
  fov: React.MutableRefObject<number>;
  joystick: React.RefObject<{ x: number; y: number }>;
}) {
  const { camera } = useThree();
  useFrame(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const target = fov.current;
    if (Math.abs(cam.fov - target) > 0.1) {
      cam.fov += (target - cam.fov) * 0.15;
      cam.updateProjectionMatrix();
    }

    if (joystick.current.x !== 0 || joystick.current.y !== 0) {
      const speedMultiplier = fov.current / 90;
      look.current.lon += joystick.current.x * 2.2 * speedMultiplier;
      look.current.lat = THREE.MathUtils.clamp(
        look.current.lat + joystick.current.y * 2.2 * speedMultiplier,
        -85,
        85
      );
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
        Loading cubemap…
      </div>
    </Html>
  );
}

export function PhotosphereViewer({ id }: { id: string }) {
  const look = useRef<Look>({ lon: 0, lat: 0 });
  const fovRef = useRef<number>(DEFAULT_FOV);
  const [, forceUpdate] = useState(0);
  const dragging = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  const lastPinchDist = useRef(0);
  const lastTouchCount = useRef(0);

  // Joystick state & refs
  const joystickRef = useRef({ x: 0, y: 0 });
  const [joystickPos, setJoystickPos] = useState({ x: 0, y: 0 });
  const joystickActive = useRef(false);
  const joystickPointerId = useRef<number | null>(null);

  const setFov = useCallback((v: number) => {
    fovRef.current = THREE.MathUtils.clamp(v, MIN_FOV, MAX_FOV);
    forceUpdate((n) => n + 1);
  }, []);

  const zoomBy = useCallback((delta: number) => {
    setFov(fovRef.current + delta);
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

  // Joystick handlers
  const onJoystickDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    joystickActive.current = true;
    joystickPointerId.current = e.pointerId;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onJoystickMove = (e: React.PointerEvent) => {
    if (!joystickActive.current || joystickPointerId.current !== e.pointerId) return;
    e.stopPropagation();

    const base = document.getElementById('joystick-base');
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = e.clientX - centerX;
    const dy = centerY - e.clientY; // Invert Y so up is positive

    const dist = Math.hypot(dx, dy);
    const maxRadius = 30; // max travel radius

    let targetX = dx;
    let targetY = dy;

    if (dist > maxRadius) {
      targetX = (dx / dist) * maxRadius;
      targetY = (dy / dist) * maxRadius;
    }

    setJoystickPos({ x: targetX, y: -targetY });

    joystickRef.current = {
      x: targetX / maxRadius,
      y: targetY / maxRadius,
    };
  };

  const onJoystickUp = (e: React.PointerEvent) => {
    if (!joystickActive.current) return;
    e.stopPropagation();
    joystickActive.current = false;
    joystickPointerId.current = null;
    setJoystickPos({ x: 0, y: 0 });
    joystickRef.current = { x: 0, y: 0 };
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

  return (
    <div
      id="photosphere-shell"
      className="relative h-[85vh] w-full select-none overflow-hidden rounded-2xl bg-black"
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
          <Cubemap id={id} />
        </Suspense>
        <CameraRig look={look} fov={fovRef} joystick={joystickRef} />
      </Canvas>

      {/* Fullscreen button — top-right, minimal */}
      <button
        onClick={toggleFullscreen}
        className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/40 backdrop-blur-sm text-white/80 hover:bg-black/60 transition-colors"
        aria-label="Toggle fullscreen"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      </button>

      {/* Joystick — translucent, matching the reference video */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
        <div
          id="joystick-base"
          className="h-[72px] w-[72px] rounded-full bg-white/10 border border-white/20 backdrop-blur-sm flex items-center justify-center pointer-events-auto"
        >
          <div
            id="joystick-handle"
            className="h-9 w-9 rounded-full bg-white/70 shadow-lg cursor-pointer flex items-center justify-center"
            style={{
              transform: `translate(${joystickPos.x}px, ${joystickPos.y}px)`,
              touchAction: 'none',
            }}
            onPointerDown={onJoystickDown}
            onPointerMove={onJoystickMove}
            onPointerUp={onJoystickUp}
            onPointerCancel={onJoystickUp}
          >
            <div className="h-2 w-2 rounded-full bg-slate-500/60" />
          </div>
        </div>
      </div>
    </div>
  );
}
