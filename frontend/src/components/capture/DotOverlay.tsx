import React from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { TARGETS, targetToWorldPos } from '@/engine/SphereTargets';
import * as THREE from 'three';
export interface TargetOverlayProps {
  activeTargetId: number | null;
  capturedIds: Set<number>;
  currentAim: { yaw: number; pitch: number };
}

const DotCamera = ({ currentAim }: { currentAim: { yaw: number, pitch: number } }) => {
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

const TargetSpheres = ({ activeTargetId, capturedIds }: { activeTargetId: number | null, capturedIds: Set<number> }) => {
  return (
    <>
      {TARGETS.map((target) => {
        const isCaptured = capturedIds.has(target.id);
        const isActive = activeTargetId === target.id;
        
        if (isCaptured) return null; // Hide captured dots entirely
        
        let color = '#34d399'; // Emerald
        if (isActive) color = '#3b82f6'; // Blue
        
        const position = targetToWorldPos(target.yaw, target.pitch, 4.9);
        
        return (
          <mesh key={target.id} position={position} onUpdate={(self) => self.lookAt(0, 0, 0)}>
            <circleGeometry args={[0.35, 32]} />
            <meshBasicMaterial 
              color={color} 
              transparent 
              opacity={0.8} 
              depthTest={false}
            />
          </mesh>
        );
      })}
    </>
  );
};

export const DotOverlay = ({ activeTargetId, capturedIds, currentAim }: TargetOverlayProps) => {
  return (
    <Canvas camera={{ fov: 65, position: [0, 0, 0] }}>
      <DotCamera currentAim={currentAim} />
      <TargetSpheres activeTargetId={activeTargetId} capturedIds={capturedIds} />
    </Canvas>
  );
};
