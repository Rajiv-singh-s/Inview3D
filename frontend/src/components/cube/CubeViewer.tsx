'use client';

import { Canvas } from '@react-three/fiber';
import { Html, useTexture } from '@react-three/drei';
import { Suspense, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { api } from '@/lib/api';
import { CUBE_FACES, CubeFace, CubeFaces } from './cubeFaces';
import { CubeScene, LookRef } from './CubeScene';

/**
 * Loads the stored face images into a fresh CubeFaces model, then renders the
 * exact same CubeScene used during capture — so exploring a saved room reuses
 * the capture renderer verbatim. Look direction is driven by drag + zoom (FOV).
 */
function LoadedCube({ id, faces, look }: { id: string; faces: CubeFace[]; look: React.RefObject<LookRef> }) {
  const urls = useMemo(() => faces.map((f) => api.cubeFaceUrl(id, f)), [id, faces]);
  const textures = useTexture(urls) as THREE.Texture[];

  const cube = useMemo(() => {
    const model = new CubeFaces();
    faces.forEach((face, i) => {
      const tex = textures[i];
      const img = tex.image as HTMLImageElement | undefined;
      if (img) model.paintImage(face, img);
    });
    return model;
  }, [faces, textures]);

  return <CubeScene faces={cube} look={look} />;
}

function LoadingHint() {
  return (
    <Html center>
      <div className="rounded-lg bg-slate-900/80 px-4 py-2 text-sm text-slate-200">
        Loading room…
      </div>
    </Html>
  );
}

export function CubeViewer({ id, faces }: { id: string; faces: CubeFace[] }) {
  const look = useRef<LookRef>({ yaw: 0, pitch: 0 });
  const [fov, setFov] = useState(80);
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    last.current = { x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - last.current.x;
    const dy = e.clientY - last.current.y;
    last.current = { x: e.clientX, y: e.clientY };
    const speed = fov / 500;
    look.current.yaw = (look.current.yaw - dx * speed + 360) % 360;
    look.current.pitch = Math.max(-89, Math.min(89, look.current.pitch + dy * speed));
  };
  const endDrag = () => (dragging.current = false);
  const onWheel = (e: React.WheelEvent) =>
    setFov((f) => THREE.MathUtils.clamp(f + e.deltaY * 0.05, 40, 100));

  const toggleFullscreen = () => {
    const el = document.querySelector('#cube-shell');
    if (!document.fullscreenElement) (el as HTMLElement)?.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  return (
    <div
      id="cube-shell"
      className="relative h-[75vh] w-full touch-none select-none overflow-hidden rounded-2xl border border-slate-800 bg-black"
      style={{ cursor: 'grab' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onWheel={onWheel}
    >
      <Canvas camera={{ fov, position: [0, 0, 0], near: 0.1, far: 100 }} dpr={[1, 2]}>
        <Suspense fallback={<LoadingHint />}>
          <LoadedCube id={id} faces={faces} look={look} />
        </Suspense>
      </Canvas>

      <div className="pointer-events-auto absolute right-3 top-3 flex gap-2">
        <button
          onClick={() => setFov((f) => THREE.MathUtils.clamp(f - 8, 40, 100))}
          className="rounded-lg bg-slate-900/70 px-3 py-1.5 text-xs font-medium text-white backdrop-blur hover:bg-slate-800"
        >
          Zoom +
        </button>
        <button
          onClick={() => setFov((f) => THREE.MathUtils.clamp(f + 8, 40, 100))}
          className="rounded-lg bg-slate-900/70 px-3 py-1.5 text-xs font-medium text-white backdrop-blur hover:bg-slate-800"
        >
          Zoom −
        </button>
        <button
          onClick={toggleFullscreen}
          className="rounded-lg bg-slate-900/70 px-3 py-1.5 text-xs font-medium text-white backdrop-blur hover:bg-slate-800"
        >
          Fullscreen
        </button>
      </div>
      <p className="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-xs text-white/60">
        Drag to look around · Scroll to zoom
      </p>
    </div>
  );
}

/** All cube faces, used when metadata omits the list. */
export const ALL_CUBE_FACES = [...CUBE_FACES];
