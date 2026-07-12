import type { CaptureResponse, Project, ViewerMetadata } from '@/types';

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
   * Finalize a capture by uploading the 16 photos. The backend will forward them 
   * to Google Colab's cloud GPU server for 3D Gaussian Splatting reconstruction.
   */
  async uploadPhotos(photos: Blob[], name: string): Promise<CaptureResponse> {
    const form = new FormData();
    form.append('name', name);
    photos.forEach((blob, i) => {
      form.append('photos', blob, `frame_${i}.jpg`);
    });
    return request<CaptureResponse>('/capture', { method: 'POST', body: form });
  },

  listProjects: () => request<Project[]>('/projects'),
  getProject: (id: string) => request<Project>(`/project/${id}`),
  getViewerMetadata: (id: string) => request<ViewerMetadata>(`/viewer/${id}`),
  deleteProject: (id: string) =>
    request<{ id: string; deleted: boolean }>(`/project/${id}`, { method: 'DELETE' }),

  /** Absolute URL of the trained 3D Gaussian Splat (.splat) file for a completed project. */
  captureSplatUrl: (id: string) => `${getApiBaseUrl()}/capture/${id}/splat`,

  /** Absolute URL of the stitched 360° equirectangular panorama for a project. */
  capturePanoramaUrl: (id: string) => `${getApiBaseUrl()}/capture/${id}/panorama`,

  /** Poll processing status: { status, progress, error }. */
  getCaptureStatus: (id: string) =>
    fetch(`${getApiBaseUrl()}/capture/${id}/status`).then((r) => r.json()),
};
