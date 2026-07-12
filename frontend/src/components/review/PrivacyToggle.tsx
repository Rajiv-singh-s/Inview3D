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
    <div className="flex flex-col space-y-1 p-1">
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-medium text-white flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Private
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={isPrivate}
          onClick={() => onChange(!isPrivate)}
          className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors focus:outline-none ${isPrivate ? 'bg-green-500' : 'bg-slate-700'}`}
        >
          <span className="sr-only">Toggle Privacy</span>
          <span
            className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform duration-200 ease-in-out shadow-sm ${isPrivate ? 'translate-x-7' : 'translate-x-1'}`}
          />
        </button>
      </div>
      <p className="text-[13px] text-slate-400 pl-7 leading-snug">
        If enabled, your asset will be hidden from the explore page.
      </p>
    </div>
  );
};
