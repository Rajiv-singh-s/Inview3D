import type {
  Project,
  StatusResponse,
  UploadResponse,
  ViewerMetadata,
} from '@/types';

/** Base URL of the NestJS backend (configurable per environment). */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

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
  const res = await fetch(`${API_BASE_URL}${path}`, init);
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
   * Upload a video with progress. Uses XHR because fetch cannot report
   * upload progress. Resolves with the created project summary.
   */
  uploadVideo(
    file: File,
    onProgress?: (percent: number) => void,
    signal?: AbortSignal,
  ): Promise<UploadResponse> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const form = new FormData();
      form.append('video', file);

      xhr.open('POST', `${API_BASE_URL}/upload`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText) as UploadResponse);
        } else {
          let message = `Upload failed (${xhr.status})`;
          try {
            const body = JSON.parse(xhr.responseText);
            const m = body?.message;
            message = Array.isArray(m) ? m.join(', ') : (m ?? message);
          } catch {
            /* ignore */
          }
          reject(new ApiError(message, xhr.status));
        }
      };
      xhr.onerror = () => reject(new ApiError('Network error during upload', 0));
      xhr.onabort = () => reject(new ApiError('Upload canceled', 0));
      if (signal) {
        signal.addEventListener('abort', () => xhr.abort());
      }
      xhr.send(form);
    });
  },

  listProjects: () => request<Project[]>('/projects'),
  getProject: (id: string) => request<Project>(`/project/${id}`),
  getStatus: (id: string) => request<StatusResponse>(`/status/${id}`),
  getViewerMetadata: (id: string) => request<ViewerMetadata>(`/viewer/${id}`),
  deleteProject: (id: string) =>
    request<{ id: string; deleted: boolean }>(`/project/${id}`, { method: 'DELETE' }),

  /** Absolute URL of the generated GLB for a completed project. */
  modelUrl: (id: string) => `${API_BASE_URL}/model/${id}`,
};
