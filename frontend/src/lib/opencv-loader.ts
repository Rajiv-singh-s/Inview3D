/**
 * Loads OpenCV.js (WASM) asynchronously.
 * Prevents multiple loading attempts and exposes the initialized `cv` object.
 */

declare global {
  interface Window {
    cv: any;
    Module: any;
  }
}

let loadPromise: Promise<any> | null = null;

export async function loadOpenCV(): Promise<any> {
  if (typeof window === 'undefined') return null; // SSR safety
  
  if (window.cv && window.cv.Mat) {
    return window.cv; // Already loaded and initialized
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = new Promise((resolve, reject) => {
    // Setup OpenCV WASM initialization hook
    window.Module = {
      ...window.Module,
      onRuntimeInitialized: () => {
        resolve(window.cv);
      }
    };

    // Create script tag
    const script = document.createElement('script');
    // For this rewrite, we assume opencv.js is placed in public/opencv/
    script.src = '/opencv/opencv.js'; 
    script.async = true;
    script.onload = () => {
      // OpenCV.js script loaded, waiting for WASM to compile (onRuntimeInitialized)
    };
    script.onerror = (err) => {
      loadPromise = null;
      reject(new Error('Failed to load OpenCV.js script: ' + err));
    };

    document.body.appendChild(script);
  });

  return loadPromise;
}
