'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { api } from '@/lib/api';
import { VirtualJoystick } from './VirtualJoystick';

export interface PanoramaViewerProps {
  id: string;
}

const DEFAULT_FOV = 78;
const MIN_FOV = 35; // zoomed in
const MAX_FOV = 100; // zoomed out

/**
 * Renders the stitched 360° equirectangular panorama on the inside of a sphere
 * with the camera at its centre — you look around the room. Drag / joystick pan
 * yaw+pitch, wheel or pinch changes FOV (zoom). This is the correct viewer for a
 * fixed-point rotation capture: photoreal, no reconstruction artefacts.
 */
export const PanoramaViewer: React.FC<PanoramaViewerProps> = ({ id }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Look state, read every frame.
  const look = useRef({ yaw: 0, pitch: 0 });
  const fovRef = useRef(DEFAULT_FOV);
  const joystick = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let raf = 0;
    let disposed = false;

    const canvas = document.createElement('canvas');
    canvas.className = 'w-full h-full block touch-none';
    container.appendChild(canvas);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 0.1, 1100);

    const geometry = new THREE.SphereGeometry(500, 96, 64);
    const material = new THREE.MeshBasicMaterial({ side: THREE.BackSide, toneMapped: false });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h || 1;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize);
    resize();

    // Load the panorama texture.
    new THREE.TextureLoader().load(
      api.capturePanoramaUrl(id),
      (texture) => {
        if (disposed) return;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        material.map = texture;
        material.needsUpdate = true;
        setLoading(false);
      },
      undefined,
      () => !disposed && setError('Could not load the panorama for this room.'),
    );

    const target = new THREE.Vector3();
    const tick = () => {
      // Joystick pans the view continuously (no translation in a panorama).
      look.current.yaw += joystick.current.x * 1.4;
      look.current.pitch = THREE.MathUtils.clamp(
        look.current.pitch - joystick.current.y * 1.1,
        -85,
        85,
      );

      const phi = THREE.MathUtils.degToRad(90 - look.current.pitch);
      const theta = THREE.MathUtils.degToRad(look.current.yaw);
      target.set(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
      );
      camera.lookAt(target);

      if (camera.fov !== fovRef.current) {
        camera.fov = fovRef.current;
        camera.updateProjectionMatrix();
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      geometry.dispose();
      material.map?.dispose();
      material.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, [id]);

  // ---- drag to look --------------------------------------------------------
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
    const speed = fovRef.current / 600;
    look.current.yaw -= dx * speed;
    look.current.pitch = THREE.MathUtils.clamp(look.current.pitch + dy * speed, -85, 85);
  };
  const endDrag = () => (dragging.current = false);
  const onWheel = (e: React.WheelEvent) => {
    fovRef.current = THREE.MathUtils.clamp(fovRef.current + e.deltaY * 0.05, MIN_FOV, MAX_FOV);
  };

  return (
    <div className="absolute inset-0 h-full w-full">
      <div
        ref={containerRef}
        className="absolute inset-0 h-full w-full cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onWheel={onWheel}
      />

      {loading && !error && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-slate-950/80 text-white">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-700 border-t-indigo-500" />
          <p className="text-sm text-slate-300">Loading 3D scene…</p>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-slate-950/90 p-6 text-center text-white">
          <p className="font-semibold text-red-300">Viewer error</p>
          <p className="text-sm text-slate-400">{error}</p>
        </div>
      )}

      {/* Joystick pans the view. */}
      <VirtualJoystick onChange={(x, y) => (joystick.current = { x, y })} />
    </div>
  );
};
