'use client';

import { Suspense, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  Bounds,
  Environment,
  Grid,
  OrbitControls,
  Stats,
  useGLTF,
  Html,
} from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { ViewerControls } from './ViewerControls';

/**
 * Loads and displays the reconstructed GLB.
 *
 * The control scheme is intentionally isolated behind {@link OrbitControls}.
 * A future phase can swap this for PointerLockControls + WASD movement and
 * collision detection without touching model loading or the scene setup.
 */
function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} />;
}

function LoadingHint() {
  return (
    <Html center>
      <div className="rounded-lg bg-slate-900/80 px-4 py-2 text-sm text-slate-200">
        Loading model…
      </div>
    </Html>
  );
}

export function ModelViewer({ url }: { url: string }) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(false);
  const [showStats, setShowStats] = useState(true);

  const resetCamera = () => controlsRef.current?.reset();

  return (
    <div
      id="viewer-shell"
      className="relative h-[70vh] w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-900"
    >
      <Canvas camera={{ position: [4, 3, 6], fov: 50 }} shadows dpr={[1, 2]}>
        <color attach="background" args={['#0b1220']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 10, 7]} intensity={1.1} castShadow />
        <Suspense fallback={<LoadingHint />}>
          <Bounds fit clip observe margin={1.2}>
            <Model url={url} />
          </Bounds>
          <Environment preset="apartment" />
        </Suspense>

        {showGrid && (
          <Grid
            args={[50, 50]}
            cellColor="#1e293b"
            sectionColor="#334155"
            infiniteGrid
            fadeDistance={40}
            position={[0, -0.01, 0]}
          />
        )}
        {showAxes && <axesHelper args={[5]} />}

        <OrbitControls
          ref={controlsRef}
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minDistance={0.5}
          maxDistance={100}
        />
        {showStats && <Stats />}
      </Canvas>

      <ViewerControls
        showGrid={showGrid}
        showAxes={showAxes}
        showStats={showStats}
        onToggleGrid={() => setShowGrid((v) => !v)}
        onToggleAxes={() => setShowAxes((v) => !v)}
        onToggleStats={() => setShowStats((v) => !v)}
        onResetCamera={resetCamera}
      />
    </div>
  );
}
