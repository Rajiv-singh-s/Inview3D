'use client';

import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export interface LookRef {
  yaw: number;
  pitch: number;
}

export interface TargetPoint3D {
  id: number;
  pos: [number, number, number];
  captured: boolean;
  isClosest: boolean;
}

interface SplatCaptureSceneProps {
  targets: TargetPoint3D[];
  look: React.RefObject<LookRef>;
}

/**
 * Renders the guided capture targets as 3D green/white spheres in space,
 * and steers the camera according to device orientation.
 */
export function CubeScene({ targets, look }: SplatCaptureSceneProps) {
  const { camera } = useThree();

  useFrame(() => {
    const { yaw, pitch } = look.current;
    const euler = new THREE.Euler(
      THREE.MathUtils.degToRad(pitch),
      THREE.MathUtils.degToRad(-yaw),
      0,
      'YXZ',
    );
    camera.quaternion.setFromEuler(euler);
  });

  return (
    <>
      <ambientLight intensity={1.5} />
      {targets.map((t) => {
        // Change color to white if it's the currently targeted/closest dot
        const color = t.captured ? '#ffffff' : t.isClosest ? '#60a5fa' : '#22c55e';
        const scale = t.isClosest ? 1.3 : 1.0;
        
        return (
          <mesh key={t.id} position={t.pos} scale={[scale, scale, scale]}>
            <sphereGeometry args={[0.22, 32, 32]} />
            <meshBasicMaterial color={color} toneMapped={false} />
          </mesh>
        );
      })}
    </>
  );
}
