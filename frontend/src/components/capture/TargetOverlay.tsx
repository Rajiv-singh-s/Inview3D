'use client';

import React from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { TARGETS, targetToWorldPos } from '@/engine/SphereTargets';
import * as THREE from 'three';

export interface TargetOverlayProps {
  activeTargetId: number | null;
  capturedIds: Set<number>;
  currentAim: { yaw: number; pitch: number };
}

const TargetSpheres = ({ activeTargetId, capturedIds, currentAim }: TargetOverlayProps) => {
  const { camera } = useThree();

  // Match R3F camera rotation to device orientation
  useFrame(() => {
    const yawRad = currentAim.yaw * (Math.PI / 180);
    const pitchRad = currentAim.pitch * (Math.PI / 180);
    
    // YXZ order commonly matches device orientation
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yawRad;
    camera.rotation.x = pitchRad;
    camera.rotation.z = 0;
  });

  return (
    <>
      <ambientLight intensity={0.6} />
      <pointLight position={[0, 0, 0]} intensity={1.2} />
      {TARGETS.map((target) => {
        const isCaptured = capturedIds.has(target.id);
        const isActive = activeTargetId === target.id;
        
        let color = '#34d399'; // Emerald for uncaptured
        if (isCaptured) color = '#ffffff'; // White for captured
        else if (isActive) color = '#3b82f6'; // Blue for active

        // Radius 5 for the spheres sphere
        const position = targetToWorldPos(target.yaw, target.pitch, 5);
        
        return (
          <mesh key={target.id} position={position}>
            <sphereGeometry args={[0.2, 32, 32]} />
            <meshStandardMaterial 
              color={color} 
              transparent 
              opacity={isCaptured ? 0.3 : 0.8} 
              emissive={color}
              emissiveIntensity={isActive ? 0.6 : 0.1}
              roughness={0.2}
              metalness={0.8}
            />
          </mesh>
        );
      })}
    </>
  );
};

/**
 * 3D Overlay rendering spheres at the target capture positions.
 */
export const TargetOverlay: React.FC<TargetOverlayProps> = (props) => {
  return (
    <div className="absolute inset-0 pointer-events-none z-10">
      <Canvas camera={{ fov: 65, position: [0, 0, 0] }}>
        <TargetSpheres {...props} />
      </Canvas>
    </div>
  );
};
