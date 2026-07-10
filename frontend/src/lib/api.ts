import type { CaptureResponse, Project, StatusResponse, ViewerMetadata } from '@/types';

const API_OVERRIDE_KEY = 'inview3d.apiBaseUrl';

/** Build-time default; may be overridden at runtime (see {@link getApiBaseUrl}). */
const BUILD_TIME_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

/**
 * Resolves the backend base URL at runtime.
 *
 * Dev/tunnel URLs change often (e.g. Cloudflare quick tunnels mint a new
 * hostname on every restart), and `NEXT_PUBLIC_*` is inlined at build time —
 * so changing it would otherwise require a full redeploy. Visiting the app
 * once with `?api=https://new-host` stores the override in localStorage.
 *
 * Precedence: `?api=` query param > stored override > build-time default.
 */
export function getApiBaseUrl(): string {
  if (typeof window === 'undefined') return BUILD_TIME_API_BASE_URL;

  const fromQuery = new URLSearchParams(window.location.search).get('api');
  if (fromQuery) {
    const cleaned = fromQuery.replace(/\/+$/, '');
    window.localStorage.setItem(API_OVERRIDE_KEY, cleaned);
    return cleaned;
  }

  return window.localStorage.getItem(API_OVERRIDE_KEY) ?? BUILD_TIME_API_BASE_URL;
}

/** Error thrown for non-2xx API responses, carrying the server message. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, init);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      const m = body?.message;
      message = Array.isArray(m) ? m.join(', ') : (m ?? message);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

export const api = {
  /**
   * Upload a guided capture. Photos must be appended in capture order — the
   * stitcher matches consecutive shots.
   */
  uploadCapture(
    photos: Blob[],
    name: string,
    /** Device orientation per photo, in capture order. Same length as `photos`. */
    poses: Array<{ yaw: number; pitch: number; face: string }>,
    onProgress?: (percent: number) => void,
    signal?: AbortSignal,
  ): Promise<CaptureResponse> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const form = new FormData();
      photos.forEach((p, i) => form.append('photos', p, `photo_${String(i).padStart(3, '0')}.jpg`));
      form.append('name', name);
      // The phone already knows where it was pointing; the stitcher should not
      // have to rediscover that from pixels alone.
      form.append('poses', JSON.stringify(poses));

      xhr.open('POST', `${getApiBaseUrl()}/panorama/capture`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText) as CaptureResponse);
        } else {
          let message = `Upload failed (${xhr.status})`;
          try {
            const m = JSON.parse(xhr.responseText)?.message;
            message = Array.isArray(m) ? m.join(', ') : (m ?? message);
          } catch {
            /* ignore */
          }
          reject(new ApiError(message, xhr.status));
        }
      };
      xhr.onerror = () => reject(new ApiError('Network error while uploading photos', 0));
      xhr.onabort = () => reject(new ApiError('Upload canceled', 0));
      if (signal) signal.addEventListener('abort', () => xhr.abort());
      xhr.send(form);
    });
  },

  listProjects: () => request<Project[]>('/projects'),
  getProject: (id: string) => request<Project>(`/project/${id}`),
  getStatus: (id: string) => request<StatusResponse>(`/status/${id}`),
  getViewerMetadata: (id: string) => request<ViewerMetadata>(`/viewer/${id}`),
  deleteProject: (id: string) =>
    request<{ id: string; deleted: boolean }>(`/project/${id}`, { method: 'DELETE' }),

  /** Absolute URL of the stitched cubemap face for a completed project. */
  panoramaFaceUrl: (id: string, face: string) => `${getApiBaseUrl()}/panorama/${id}/faces/${face}`,
};
