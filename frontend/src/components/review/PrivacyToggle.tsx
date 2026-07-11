'use client';

import React from 'react';

/**
 * Props for the PrivacyToggle component.
 */
export interface PrivacyToggleProps {
  /**
   * Whether the scan is private.
   */
  isPrivate: boolean;
  /**
   * Callback fired when the toggle state changes.
   * @param val The new privacy state (true for private, false for public)
   */
  onChange: (val: boolean) => void;
}

/**
 * A sleek, animated toggle switch for selecting between Private and Public scan settings.
 * Uses glassmorphism and dark mode styling.
 */
export const PrivacyToggle: React.FC<PrivacyToggleProps> = ({ isPrivate, onChange }) => {
  return (
    <div className="flex items-center space-x-4 p-4 rounded-xl bg-white/5 border border-white/10 backdrop-blur-md">
      <span className={`text-sm font-medium transition-colors ${!isPrivate ? 'text-white' : 'text-slate-400'}`}>
        Public
      </span>
      
      <button
        type="button"
        role="switch"
        aria-checked={isPrivate}
        onClick={() => onChange(!isPrivate)}
        className="relative inline-flex h-8 w-16 items-center rounded-full bg-slate-900 border border-white/20 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2 focus:ring-offset-slate-900 shadow-inner"
      >
        <span className="sr-only">Toggle Privacy</span>
        <span
          className={`
            inline-block h-6 w-6 transform rounded-full bg-white transition-transform duration-300 ease-in-out shadow-md
            ${isPrivate ? 'translate-x-9' : 'translate-x-1'}
          `}
        />
      </button>

      <span className={`text-sm font-medium transition-colors ${isPrivate ? 'text-white' : 'text-slate-400'}`}>
        Private
      </span>
    </div>
  );
};
