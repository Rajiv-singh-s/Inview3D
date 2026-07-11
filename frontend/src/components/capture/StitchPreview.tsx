'use client';

import React, { useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useCaptureStore } from '@/store/captureStore';
import { targetToWorldPos } from '@/engine/SphereTargets';

const ProjectedFrame = ({ frame }: { frame: any }) => {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  
  const texture = useMemo(() => {
    if (!frame.thumbnailUrl || frame.thumbnailUrl === '') return null;
    try {
      return new THREE.TextureLoader().load(frame.thumbnailUrl);
    } catch (e) {
      console.warn("Failed to load texture", e);
      return null;
    }
  }, [frame.thumbnailUrl]);

  const radius = 4.5;
  const pos = targetToWorldPos(frame.pose?.yaw || 0, frame.pose?.pitch || 0, radius);
  const position = new THREE.Vector3(...pos);

  // Exact math to match FOV and stitch perfectly
  const height = 2 * Math.tan((camera.fov / 2) * (Math.PI / 180)) * radius;
  const width = height * camera.aspect;

  return (
    <mesh position={position} onUpdate={(self) => self.lookAt(0, 0, 0)}>
      <planeGeometry args={[width, height]} />
      {texture ? (
        <meshBasicMaterial map={texture} side={THREE.DoubleSide} transparent opacity={0.9} />
      ) : (
        <meshBasicMaterial color="#333" side={THREE.DoubleSide} transparent opacity={0.5} />
      )}
    </mesh>
  );
};

/**
 * Renders a low-fidelity live preview of captured frames projected onto a sphere.
 */
export const StitchPreview: React.FC = () => {
  const capturedFrames = useCaptureStore((state) => state.capturedFrames);
  const frames = Object.values(capturedFrames);

  if (frames.length === 0) return null;

  return (
    <div className="absolute top-24 right-5 w-32 h-32 rounded-2xl overflow-hidden border border-white/20 bg-slate-900/60 backdrop-blur-md z-40 shadow-xl pointer-events-none">
      <Canvas camera={{ position: [0, 0, 11], fov: 60 }}>
        <ambientLight intensity={1} />
        <group rotation={[0, 0, 0]}>
          {/* Base wireframe sphere representing the object bounds */}
          <mesh>
            <icosahedronGeometry args={[4.4, 2]} />
            <meshBasicMaterial color="#3b82f6" wireframe transparent opacity={0.15} />
          </mesh>
          
          {frames.map((frame) => (
            <ProjectedFrame key={frame.targetId} frame={frame} />
          ))}
        </group>
      </Canvas>
    </div>
  );
};
