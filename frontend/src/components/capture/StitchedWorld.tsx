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

  const height = 2 * Math.tan((camera.fov / 2) * (Math.PI / 180)) * radius;
  const width = height * camera.aspect;

  return (
    <mesh position={pos} onUpdate={(self) => self.lookAt(0, 0, 0)}>
      <planeGeometry args={[width, height]} />
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

export const StitchedWorld = ({ currentAim, capturedFrames }: { currentAim: { yaw: number, pitch: number }, capturedFrames: Record<number, CapturedFrame> }) => {
  const frames = Object.values(capturedFrames);
  return (
    <Canvas camera={{ fov: 65, position: [0, 0, 0] }}>
      <color attach="background" args={['#000000']} />
      <ambientLight intensity={1.0} />
      <WorldCamera currentAim={currentAim} />
      {frames.map((frame) => (
        <ProjectedFrame key={frame.targetId} frame={frame} />
      ))}
    </Canvas>
  );
};
