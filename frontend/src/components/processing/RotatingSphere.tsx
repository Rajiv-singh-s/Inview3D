'use client';

import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

function SphereMesh() {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (meshRef.current) {
      // Rotation on both Y and X axes
      meshRef.current.rotation.y = state.clock.getElapsedTime() * 0.4;
      meshRef.current.rotation.x = Math.sin(state.clock.getElapsedTime() * 0.25) * 0.15;
    }
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[2.2, 32, 32]} />
      <meshStandardMaterial
        color="#10b981" // Green brand color matching the reference video
        wireframe
        transparent
        opacity={0.7}
      />
      <gridHelper args={[6, 12, '#34d399', '#065f46']} rotation={[Math.PI / 2, 0, 0]} />
    </mesh>
  );
}

export function RotatingSphere() {
  return (
    <div className="h-[250px] w-full max-w-[250px] mx-auto relative select-none">
      <Canvas camera={{ position: [0, 0, 4.5], fov: 60 }} gl={{ antialias: true }}>
        <ambientLight intensity={0.6} />
        <pointLight position={[10, 10, 10]} intensity={1.2} />
        <SphereMesh />
      </Canvas>
    </div>
  );
}
