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

  // Calculate full screen world height/width at this radius
  // For a CUBICLE projection, we want the walls to be flat.
  // We project the yaw/pitch ray onto a cube of size 10x10x10 (radius 5).
  // The camera is at 0,0,0.
  const ray = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(-frame.pose.pitch * (Math.PI/180), -frame.pose.yaw * (Math.PI/180), 0, 'YXZ'));
  
  // Find intersection with box bounds [-5, 5]
  let t = 5;
  if (Math.abs(ray.x) > 0.001) t = Math.min(t, 5 / Math.abs(ray.x));
  if (Math.abs(ray.y) > 0.001) t = Math.min(t, 5 / Math.abs(ray.y));
  if (Math.abs(ray.z) > 0.001) t = Math.min(t, 5 / Math.abs(ray.z));
  
  const cubePos = ray.clone().multiplyScalar(t);
  
  // To keep the wall perfectly flat, the plane must face exactly along the major axis of the wall it hit.
  const isXWall = Math.abs(Math.abs(cubePos.x) - 5) < 0.01;
  const isYWall = Math.abs(Math.abs(cubePos.y) - 5) < 0.01;
  const isZWall = Math.abs(Math.abs(cubePos.z) - 5) < 0.01;
  
  const wallEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  if (isXWall) wallEuler.y = cubePos.x > 0 ? Math.PI / 2 : -Math.PI / 2;
  else if (isYWall) wallEuler.x = cubePos.y > 0 ? -Math.PI / 2 : Math.PI / 2;
  else wallEuler.y = cubePos.z > 0 ? Math.PI : 0;

  // The size of the plane needs to scale up based on the distance to avoid gaps on the corners.
  // Standard fullHeight at distance 5 is:
  const baseHeight = 2 * Math.tan((camera.fov / 2) * (Math.PI / 180)) * 5;
  const baseWidth = baseHeight * camera.aspect;
  
  // Scale by the actual intersection distance 't' to fill the perspective accurately
  const scale = t / 5;
  const height = baseHeight * 0.55 * scale;
  const width = baseWidth * 0.75 * scale;

  return (
    <mesh position={cubePos} rotation={wallEuler}>
      <planeGeometry args={[width, height]} />
      {texture ? (
        <meshBasicMaterial 
          map={texture} 
          side={THREE.DoubleSide} 
          transparent 
          opacity={1.0}
          onBeforeCompile={(shader) => {
            shader.fragmentShader = shader.fragmentShader.replace(
              '#include <map_fragment>',
              `
              #include <map_fragment>
              float edgeX = smoothstep(0.0, 0.15, vMapUv.x) * smoothstep(1.0, 0.85, vMapUv.x);
              float edgeY = smoothstep(0.0, 0.15, vMapUv.y) * smoothstep(1.0, 0.85, vMapUv.y);
              diffuseColor.a *= edgeX * edgeY;
              `
            );
          }}
        />
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
        const isActive = target.id === activeTargetId;
        
        if (isCaptured) return null; // Hide captured dots entirely
        
        // For Cubicle projection, map the dots to the cube walls too
        const ray = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(-target.pitch * (Math.PI/180), -target.yaw * (Math.PI/180), 0, 'YXZ'));
        let t = 4.9; // Slightly in front of the wall
        if (Math.abs(ray.x) > 0.001) t = Math.min(t, 4.9 / Math.abs(ray.x));
        if (Math.abs(ray.y) > 0.001) t = Math.min(t, 4.9 / Math.abs(ray.y));
        if (Math.abs(ray.z) > 0.001) t = Math.min(t, 4.9 / Math.abs(ray.z));
        
        const position = ray.clone().multiplyScalar(t);
        
        return (
          <Html key={target.id} position={position} center style={{ zIndex: 30 }}>
            <div className={`rounded-full bg-[#16a34a] opacity-90 drop-shadow-md transition-all duration-300 ${isActive ? 'w-[64px] h-[64px]' : 'w-[24px] h-[24px]'}`} />
          </Html>
        );
      })}
    </>
  );
};

const LiveVideoPlane = ({ currentAim, video }: { currentAim: { yaw: number, pitch: number }, video: HTMLVideoElement | null }) => {
  const { camera } = useThree();
  const radius = 5.0;

  const texture = useMemo(() => {
    if (!video) return null;
    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [video]);

  useFrame(() => {
    if (!texture || !video) return;
    
    const fullHeight = 2 * Math.tan(((camera as THREE.PerspectiveCamera).fov / 2) * (Math.PI / 180)) * radius;
    const fullWidth = fullHeight * (camera as THREE.PerspectiveCamera).aspect;
    const planeW = fullWidth * 0.75;
    const planeH = fullHeight * 0.55;
    
    const planeAspect = planeW / planeH;
    const videoAspect = video.videoWidth / video.videoHeight;
    
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      const scaleX = planeAspect > videoAspect ? 1 : videoAspect / planeAspect;
      const scaleY = planeAspect > videoAspect ? planeAspect / videoAspect : 1;
      texture.repeat.set(1 / scaleX, 1 / scaleY);
      texture.offset.set((1 - 1 / scaleX) / 2, (1 - 1 / scaleY) / 2);
    }
  });

  if (!texture) return null;

  const yawRad = currentAim.yaw * (Math.PI / 180);
  const pitchRad = currentAim.pitch * (Math.PI / 180);
  const euler = new THREE.Euler(-pitchRad, -yawRad, 0, 'YXZ');
  const pos = new THREE.Vector3(0, 0, -radius).applyEuler(euler);

  const fullHeight = 2 * Math.tan(((camera as THREE.PerspectiveCamera).fov / 2) * (Math.PI / 180)) * radius;
  const fullWidth = fullHeight * (camera as THREE.PerspectiveCamera).aspect;
  const planeW = fullWidth * 0.75;
  const planeH = fullHeight * 0.55;

  return (
    <mesh position={pos} rotation={euler}>
      <planeGeometry args={[planeW, planeH]} />
      <meshBasicMaterial map={texture} side={THREE.DoubleSide} />
    </mesh>
  );
};

export const StitchedWorld = ({ currentAim, capturedFrames, activeTargetId, capturedIds, mode, liveVideo }: { currentAim: { yaw: number, pitch: number }, capturedFrames: Record<number, CapturedFrame>, activeTargetId: number | null, capturedIds: Set<number>, mode?: 'background' | 'foreground', liveVideo?: HTMLVideoElement | null }) => {
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
      {isBg && <LiveVideoPlane currentAim={currentAim} video={liveVideo ?? null} />}
      {isFg && <TargetSpheres activeTargetId={activeTargetId} capturedIds={capturedIds} />}
    </Canvas>
  );
};
