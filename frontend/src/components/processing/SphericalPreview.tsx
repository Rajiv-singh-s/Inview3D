'use client';

import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useCaptureStore } from '@/store/captureStore';
import { targetToWorldPos } from '@/engine/SphereTargets';

const ProjectedFrame = ({ frame }: { frame: any }) => {
  const texture = useMemo(() => {
    if (!frame.thumbnailUrl) return null;
    return new THREE.TextureLoader().load(frame.thumbnailUrl);
  }, [frame.thumbnailUrl]);

  const pos = targetToWorldPos(frame.pose?.yaw || 0, frame.pose?.pitch || 0, 2);
  const position = new THREE.Vector3(...pos);

  return (
    <mesh position={position} onUpdate={(self) => self.lookAt(0, 0, 0)}>
      <planeGeometry args={[1.0, 0.75]} />
      {texture ? (
        <meshBasicMaterial map={texture} side={THREE.DoubleSide} transparent opacity={0.8} />
      ) : (
        <meshBasicMaterial color="#333" side={THREE.DoubleSide} transparent opacity={0.5} />
      )}
    </mesh>
  );
};

const SpinningScene = () => {
  const groupRef = useRef<THREE.Group>(null);
  const capturedFrames = useCaptureStore((state) => state.capturedFrames);
  const frames = Object.values(capturedFrames);

  useFrame((state, delta) => {
    if (groupRef.current) {
      // Auto-rotate the scene for a panoramic feel
      groupRef.current.rotation.y -= delta * 0.5;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh>
        <icosahedronGeometry args={[1.9, 2]} />
        <meshBasicMaterial color="#3b82f6" wireframe transparent opacity={0.2} />
      </mesh>
      {frames.map((frame, index) => (
        // Fallback key if targetId is somehow undefined
        <ProjectedFrame key={frame.targetId ?? index} frame={frame} />
      ))}
    </group>
  );
};

/**
 * Lightweight spinning preview that maps captured frames to their 
 * respective 3D coordinates. Used during the processing phase.
 */
export const SphericalPreview: React.FC = () => {
  return (
    <div className="w-48 h-48 rounded-full overflow-hidden border-4 border-slate-700 bg-slate-900/50 backdrop-blur-md shadow-[0_0_30px_rgba(59,130,246,0.3)]">
      <Canvas camera={{ position: [0, 0, 4.5], fov: 50 }}>
        <SpinningScene />
      </Canvas>
    </div>
  );
};
