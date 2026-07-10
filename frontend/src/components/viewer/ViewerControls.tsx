'use client';

import { useCallback } from 'react';

interface ViewerControlsProps {
  showGrid: boolean;
  showAxes: boolean;
  showStats: boolean;
  onToggleGrid: () => void;
  onToggleAxes: () => void;
  onToggleStats: () => void;
  onResetCamera: () => void;
}

/** Floating overlay toolbar for the 3D viewer. */
export function ViewerControls({
  showGrid,
  showAxes,
  showStats,
  onToggleGrid,
  onToggleAxes,
  onToggleStats,
  onResetCamera,
}: ViewerControlsProps) {
  const toggleFullscreen = useCallback(() => {
    const el = document.querySelector('#viewer-shell') ?? document.documentElement;
    if (!document.fullscreenElement) {
      (el as HTMLElement).requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }, []);

  const Btn = ({
    active,
    onClick,
    children,
  }: {
    active?: boolean;
    onClick: () => void;
    children: React.ReactNode;
  }) => (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
        active ? 'bg-brand-500 text-white' : 'bg-slate-800/80 text-slate-200 hover:bg-slate-700'
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="pointer-events-auto absolute right-3 top-3 flex flex-wrap justify-end gap-2">
      <Btn active={showGrid} onClick={onToggleGrid}>
        Grid
      </Btn>
      <Btn active={showAxes} onClick={onToggleAxes}>
        Axes
      </Btn>
      <Btn active={showStats} onClick={onToggleStats}>
        FPS
      </Btn>
      <Btn onClick={onResetCamera}>Reset</Btn>
      <Btn onClick={toggleFullscreen}>Fullscreen</Btn>
    </div>
  );
}
