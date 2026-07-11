export type ProjectStatus = 'uploading' | 'processing' | 'completed' | 'failed';

export interface GeoLocation {
  lat: number;
  lon: number;
  name?: string;
}

export interface Project {
  id: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  originalName: string;
  location?: GeoLocation;
  progress?: number;
  error?: string;
}
