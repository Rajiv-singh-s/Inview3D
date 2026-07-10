'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { CUBE_FACES, CubeFace, CubeFaces } from './cubeFaces';

/** Half-size of the room cube. Camera sits at the origin, inside. */
const D = 8;

/** Placement of each inward-facing wall: position and Euler rotation. */
const FACE_TRANSFORMS: Record<CubeFace, { pos: [number, number, number]; rot: [number, number, number] }> = {
  front: { pos: [0, 0, -D], rot: [0, 0, 0] },
  back: { pos: [0, 0, D], rot: [0, Math.PI, 0] },
  right: { pos: [D, 0, 0], rot: [0, -Math.PI / 2, 0] },
  left: { pos: [-D, 0, 0], rot: [0, Math.PI / 2, 0] },
  top: { pos: [0, D, 0], rot: [Math.PI / 2, 0, 0] },
  bottom: { pos: [0, -D, 0], rot: [-Math.PI / 2, 0, 0] },
};

/** Mutable look direction the parent updates each frame (device orientation or drag). */
export interface LookRef {
  yaw: number;
  pitch: number;
}

interface CubeSceneProps {
  faces: CubeFaces;
  look: React.RefObject<LookRef>;
}

/**
 * Renders the room as six inward-facing textured planes with the camera at the
 * centre, and steers that camera from `look` every frame. The same textures are
 * painted live during capture and reused by the viewer, so what the user builds
 * is exactly what they later explore.
 */
export function CubeScene({ faces, look }: CubeSceneProps) {
  const { camera } = useThree();

  const walls = useMemo(
    () =>
      CUBE_FACES.map((face) => ({
        face,
        transform: FACE_TRANSFORMS[face],
        texture: faces.textures.get(face)!,
      })),
    [faces],
  );

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
      {walls.map(({ face, transform, texture }) => (
        <mesh key={face} position={transform.pos} rotation={transform.rot}>
          <planeGeometry args={[2 * D, 2 * D]} />
          <meshBasicMaterial map={texture} side={THREE.FrontSide} toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}
