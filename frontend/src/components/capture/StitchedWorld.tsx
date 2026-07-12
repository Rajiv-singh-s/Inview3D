import React, { useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { targetToWorldPos } from '@/engine/SphereTargets';
import * as THREE from 'three';
import { CapturedFrame } from '@/types';

const ProjectedFrame = ({ frame }: { frame: CapturedFrame }) => {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  
  const texture = useMemo(() => {
    if (!frame.thumbnailUrl) return null;
    try {
      const tex = new THREE.TextureLoader().load(frame.thumbnailUrl);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    } catch (e) {
      return null;
    }
  }, [frame.thumbnailUrl]);

  const radius = 5.0;
  const pos = targetToWorldPos(frame.pose?.yaw || 0, frame.pose?.pitch || 0, radius);

  // Calculate full screen world height/width at this radius
  const height = 2 * Math.tan((camera.fov / 2) * (Math.PI / 180)) * radius;
  const width = height * camera.aspect;
  
  // Scale down to match the 64% x 50% central viewfinder rectangle
  const rectHeight = height * 0.50;
  const rectWidth = width * 0.64;

  return (
    <mesh position={pos} onUpdate={(self) => self.lookAt(0, 0, 0)}>
      <planeGeometry args={[rectWidth, rectHeight]} />
      {texture ? (
        <meshBasicMaterial map={texture} side={THREE.DoubleSide} transparent opacity={1.0} />
      ) : (
        <meshBasicMaterial color="#222" side={THREE.DoubleSide} />
      )}
    </mesh>
  );
};

const WorldCamera = ({ currentAim }: { currentAim: { yaw: number, pitch: number } }) => {
  const { camera } = useThree();

  useFrame(() => {
    const yawRad = currentAim.yaw * (Math.PI / 180);
    const pitchRad = currentAim.pitch * (Math.PI / 180);
    
    camera.rotation.order = 'YXZ';
    camera.rotation.y = -yawRad;
    camera.rotation.x = -pitchRad;
    camera.rotation.z = 0;
  });
  return null;
};

import { Html } from '@react-three/drei';
import { TARGETS } from '@/engine/SphereTargets';

const TargetSpheres = ({ activeTargetId, capturedIds }: { activeTargetId: number | null, capturedIds: Set<number> }) => {
  return (
    <>
      {TARGETS.map((target) => {
        const isCaptured = capturedIds.has(target.id);
        const isActive = activeTargetId === target.id;
        
        if (isCaptured) return null; // Hide captured dots entirely
        
        const position = targetToWorldPos(target.yaw, target.pitch, 4.9);
        
        return (
          <Html key={target.id} position={position} center style={{ zIndex: 20 }}>
            <div 
              className={`rounded-full transition-all duration-200 ${isActive ? 'bg-blue-500 w-7 h-7 shadow-[0_0_15px_rgba(59,130,246,0.8)]' : 'bg-green-500 w-5 h-5'}`} 
              style={{ opacity: 0.9, border: '2px solid white' }} 
            />
          </Html>
        );
      })}
    </>
  );
};

export const StitchedWorld = ({ currentAim, capturedFrames, activeTargetId, capturedIds }: { currentAim: { yaw: number, pitch: number }, capturedFrames: Record<number, CapturedFrame>, activeTargetId: number | null, capturedIds: Set<number> }) => {
  const frames = Object.values(capturedFrames);
  return (
    <Canvas camera={{ fov: 65, position: [0, 0, 0] }}>
      <color attach="background" args={['#000000']} />
      <ambientLight intensity={1.0} />
      <WorldCamera currentAim={currentAim} />
      {frames.map((frame) => (
        <ProjectedFrame key={frame.targetId} frame={frame} />
      ))}
      <TargetSpheres activeTargetId={activeTargetId} capturedIds={capturedIds} />
    </Canvas>
  );
};
