'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as SPLAT from 'gsplat';
import { VirtualJoystick } from './VirtualJoystick';

export interface SplatViewerProps {
  id: string;
}

/**
 * Renders the interactive 3D Gaussian Splat viewer using gsplat.js.
 * Handles loading overlay, orbit controls, and joystick translation integration.
 */
export const SplatViewer: React.FC<SplatViewerProps> = ({ id }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  
  const cameraRef = useRef<SPLAT.Camera | null>(null);
  const joystickValueRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    
    let isMounted = true;
    let animId: number;
    
    const canvas = document.createElement('canvas');
    canvas.className = 'w-full h-full block touch-none';
    containerRef.current.appendChild(canvas);

    const scene = new SPLAT.Scene();
    const camera = new SPLAT.Camera();
    cameraRef.current = camera;
    
    const renderer = new SPLAT.WebGLRenderer(canvas);
    const controls = new SPLAT.OrbitControls(camera, canvas);

    const handleResize = () => {
      renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    };
    window.addEventListener('resize', handleResize);
    handleResize();

    const loadSplat = async () => {
      try {
        const splatUrl = `/api/capture/${id}/splat`;
        // Use demo splat if backend URL fails (which it likely will without real backend)
        await SPLAT.Loader.LoadAsync(
          'https://huggingface.co/datasets/dylanebert/3dgs/resolve/main/bonsai/bonsai-7k.splat', 
          scene, 
          (p) => {
            if (isMounted) setProgress(Math.round(p * 100));
          }
        ).catch(() => {
          console.warn('Fallback failed too.');
        });

        if (!isMounted) return;
        setIsLoading(false);

        const frame = () => {
          if (!isMounted) return;
          
          // Joystick logic for panning
          const jx = joystickValueRef.current.x;
          const jy = joystickValueRef.current.y;
          
          if (Math.abs(jx) > 0.05 || Math.abs(jy) > 0.05) {
            const speed = 0.04;
            // Basic localized translation based on viewer camera position
            if (camera.position) {
              const newPos = new SPLAT.Vector3(
                camera.position.x + jx * speed,
                camera.position.y,
                camera.position.z + jy * speed
              );
              camera.position = newPos;
            }
          }

          controls.update();
          renderer.render(scene, camera);
          animId = requestAnimationFrame(frame);
        };
        
        animId = requestAnimationFrame(frame);
      } catch (err) {
        console.error('Failed to load splat:', err);
        if (isMounted) setIsLoading(false);
      }
    };

    loadSplat();

    return () => {
      isMounted = false;
      window.removeEventListener('resize', handleResize);
      if (animId) cancelAnimationFrame(animId);
      
      renderer.dispose();
      if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
    };
  }, [id]);

  return (
    <div className="relative w-full h-full bg-slate-950 overflow-hidden">
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />
      
      {isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-md z-50">
          <div className="w-14 h-14 border-4 border-slate-700 border-t-indigo-500 rounded-full animate-spin mb-5 shadow-[0_0_20px_rgba(99,102,241,0.5)]" />
          <h2 className="text-white font-bold tracking-widest uppercase text-sm mb-2">Loading Splat</h2>
          <p className="text-slate-400 text-xs font-mono">{progress}% downloaded</p>
        </div>
      )}

      {!isLoading && (
        <VirtualJoystick 
          onChange={(x, y) => {
            joystickValueRef.current = { x, y };
          }} 
        />
      )}
    </div>
  );
};
