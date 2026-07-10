'use client';

import { Suspense, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Html, OrbitControls, useTexture } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';

/**
 * Renders a stitched panorama on the inside of a sphere with the camera at its
 * centre — the Street View model. Nothing is reconstructed: the pixels are the
 * original photographs, which is why it stays photoreal.
 *
 * Contrast with `ModelViewer`, which orbits *around* a reconstructed mesh.
 */
function Sphere({ url }: { url: string }) {
  const texture = useTexture(url);
  // The panorama is authored left-to-right; flipping X puts us inside looking out
  // with correct handedness. Colour space matters or the image looks washed out.
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  return (
    <mesh>
      {/* Large radius so the sphere never clips the near plane. */}
      <sphereGeometry args={[500, 64, 40]} />
      <meshBasicMaterial map={texture} side={THREE.BackSide} toneMapped={false} />
    </mesh>
  );
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
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const [fov, setFov] = useState(75);

  const reset = () => {
    controlsRef.current?.reset();
    setFov(75);
  };

  const toggleFullscreen = () => {
    const el = document.querySelector('#photosphere-shell');
    if (!document.fullscreenElement) (el as HTMLElement)?.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  return (
    <div
      id="photosphere-shell"
      className="relative h-[70vh] w-full overflow-hidden rounded-2xl border border-slate-800 bg-black"
    >
      <Canvas camera={{ fov, position: [0, 0, 0.1], near: 0.1, far: 1000 }} dpr={[1, 2]}>
        <Suspense fallback={<LoadingHint />}>
          <Sphere url={url} />
        </Suspense>
        <OrbitControls
          ref={controlsRef}
          makeDefault
          // Camera sits at the sphere's centre: rotate only, never pan or dolly out.
          enablePan={false}
          enableZoom
          enableDamping
          dampingFactor={0.08}
          // Negative speed so dragging left looks left, as in Street View.
          rotateSpeed={-0.35}
          minDistance={0.01}
          maxDistance={0.02}
          target={[0, 0, 0]}
        />
      </Canvas>

      <div className="pointer-events-auto absolute right-3 top-3 flex gap-2">
        <button
          onClick={reset}
          className="rounded-lg bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
        >
          Reset view
        </button>
        <button
          onClick={toggleFullscreen}
          className="rounded-lg bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
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
