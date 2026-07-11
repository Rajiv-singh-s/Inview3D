'use client';

import React, { useState, useEffect, useRef } from 'react';

export interface VirtualJoystickProps {
  /**
   * Callback fired when joystick moves. 
   * @param x Normalized X axis (-1 to 1)
   * @param y Normalized Y axis (-1 to 1)
   */
  onChange: (x: number, y: number) => void;
}

/**
 * Translucent on-screen joystick for translating the camera.
 * Features a glassmorphism base and physical knob constraint.
 */
export const VirtualJoystick: React.FC<VirtualJoystickProps> = ({ onChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [knobPos, setKnobPos] = useState({ x: 0, y: 0 });
  const [isActive, setIsActive] = useState(false);
  const maxRadius = 40; // Max pixels the knob can travel from center

  const updatePosition = (clientX: number, clientY: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    let dx = clientX - centerX;
    let dy = clientY - centerY;
    
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    // Clamp to outer circle
    if (dist > maxRadius) {
      const angle = Math.atan2(dy, dx);
      dx = Math.cos(angle) * maxRadius;
      dy = Math.sin(angle) * maxRadius;
    }
    
    setKnobPos({ x: dx, y: dy });
    onChange(dx / maxRadius, dy / maxRadius);
  };

  const resetPosition = () => {
    setKnobPos({ x: 0, y: 0 });
    onChange(0, 0);
    setIsActive(false);
  };

  useEffect(() => {
    const handleMouseUp = () => {
      if (isActive) resetPosition();
    };
    
    const handleMouseMove = (e: MouseEvent) => {
      if (isActive) updatePosition(e.clientX, e.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (isActive && e.touches[0]) {
        updatePosition(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const handleTouchEnd = () => {
      if (isActive) resetPosition();
    };

    if (isActive) {
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('touchend', handleTouchEnd);
      window.addEventListener('touchmove', handleTouchMove, { passive: false });
    }

    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchmove', handleTouchMove);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  return (
    <div className="absolute bottom-10 left-10 z-40 touch-none">
      <div 
        ref={containerRef}
        className="relative w-28 h-28 rounded-full border-2 border-white/20 bg-white/5 backdrop-blur-md shadow-[0_0_15px_rgba(255,255,255,0.1)] flex items-center justify-center pointer-events-auto cursor-pointer"
        onMouseDown={(e) => {
          setIsActive(true);
          updatePosition(e.clientX, e.clientY);
        }}
        onTouchStart={(e) => {
          setIsActive(true);
          if (e.touches[0]) updatePosition(e.touches[0].clientX, e.touches[0].clientY);
        }}
      >
        <div 
          className="absolute w-12 h-12 rounded-full bg-white/40 border border-white/50 shadow-inner backdrop-blur-lg"
          style={{
            transform: `translate(${knobPos.x}px, ${knobPos.y}px)`,
            transition: isActive ? 'none' : 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
          }}
        />
      </div>
    </div>
  );
};
