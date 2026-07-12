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
  const fullHeight = 2 * Math.tan((camera.fov / 2) * (Math.PI / 180)) * radius;
  const fullWidth = fullHeight * camera.aspect;

  // The viewfinder white box is 75% width and 55% height of the screen.
  // The captured photo is exactly cropped to this viewfinder.
  // Therefore, the plane MUST perfectly match these exact proportions to stitch seamlessly!
  const height = fullHeight * 0.55;
  const width = fullWidth * 0.75;

  return (
    <mesh position={pos} onUpdate={(self) => self.lookAt(0, 0, 0)}>
      <planeGeometry args={[width, height]} />
      {texture ? (
        <meshBasicMaterial map={texture} side={THREE.DoubleSide} transparent opacity={0.9} />
      ) : (
        <meshBasicMaterial color="#222" side={THREE.DoubleSide} transparent opacity={0.5} />
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
        
        if (isCaptured) return null; // Hide captured dots entirely
        
        const position = targetToWorldPos(target.yaw, target.pitch, 4.9);
        
        return (
          <Html key={target.id} position={position} center style={{ zIndex: 30 }}>
            <div className="rounded-full bg-[#16a34a] w-[44px] h-[44px] opacity-90 drop-shadow-md" />
          </Html>
        );
      })}
    </>
  );
};

export const StitchedWorld = ({ currentAim, capturedFrames, activeTargetId, capturedIds, mode }: { currentAim: { yaw: number, pitch: number }, capturedFrames: Record<number, CapturedFrame>, activeTargetId: number | null, capturedIds: Set<number>, mode?: 'background' | 'foreground' }) => {
  const frames = Object.values(capturedFrames);
  const isBg = mode === 'background' || mode == null;
  const isFg = mode === 'foreground' || mode == null;
  return (
    <Canvas camera={{ fov: 75, position: [0, 0, 0] }} gl={{ alpha: true }}>
      <ambientLight intensity={1.0} />
      <WorldCamera currentAim={currentAim} />
      {isBg && frames.map((frame) => (
        <ProjectedFrame key={frame.targetId} frame={frame} />
      ))}
      {isFg && <TargetSpheres activeTargetId={activeTargetId} capturedIds={capturedIds} />}
    </Canvas>
  );
};
