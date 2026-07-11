import { Injectable, Logger } from '@nestjs/common';
import { ProjectsService } from '../projects/projects.service';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createReadStream } from 'fs';

@Injectable()
export class CaptureService {
  private readonly logger = new Logger(CaptureService.name);
  private readonly colabUrl: string;

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly configService: ConfigService,
  ) {
    const config = this.configService.getOrThrow<AppConfig>('app');
    this.colabUrl = config.colabApiUrl;
  }

  async storeCapture(
    files: Express.Multer.File[],
    name: string,
    location?: any,
    poses?: any,
    isPrivate?: boolean,
  ) {
    // Create project entry
    const project = this.projectsService.createProject(name);
    
    // Update location and privacy status
    project.location = location;
    project.status = 'uploading';
    this.projectsService.updateProject(project.id, { location, status: 'uploading' });

    // Store files locally for backup/testing
    const projectDir = path.join(process.cwd(), 'data', project.id);
    await fs.mkdir(projectDir, { recursive: true });

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const filePath = path.join(projectDir, `capture_${i}.jpg`);
      await fs.writeFile(filePath, file.buffer);
    }

    // Fire off async Colab processing pipeline
    this.triggerColabProcessing(project.id, files, poses).catch((err) => {
      this.logger.error(`Colab processing failed for ${project.id}:`, err);
      this.projectsService.updateProject(project.id, { status: 'failed', error: err.message });
    });

    return { id: project.id, status: project.status, originalName: project.originalName };
  }

  private async triggerColabProcessing(projectId: string, files: Express.Multer.File[], poses: any) {
    this.projectsService.updateProject(projectId, { status: 'processing', progress: 0 });
    
    // In a real scenario, this would use fetch() with FormData to hit the Colab /process endpoint.
    // For this prototype/rewrite, we will simulate the connection if colabUrl is not available,
    // or we'll forward it.
    
    if (!this.colabUrl) {
      this.logger.warn('No COLAB_API_URL configured, simulating processing delay...');
      // Simulate processing
      for(let i=10; i<=100; i+=10) {
        await new Promise(r => setTimeout(r, 1000));
        this.projectsService.updateProject(projectId, { progress: i });
      }
      this.projectsService.updateProject(projectId, { status: 'completed' });
      return;
    }

    try {
      const formData = new FormData();
      formData.append('poses', JSON.stringify(poses));
      files.forEach((f, i) => {
        const blob = new Blob([new Uint8Array(f.buffer)], { type: f.mimetype });
        formData.append('photos', blob, `capture_${i}.jpg`);
      });

      const res = await fetch(`${this.colabUrl}/process`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`Colab returned ${res.status}: ${await res.text()}`);
      }

      const data = await res.json();
      
      // We would poll /status here until completion, then download the .splat file
      // Simplified for the rewrite plan:
      this.projectsService.updateProject(projectId, { status: 'completed', progress: 100 });
      
    } catch (e: any) {
      this.projectsService.updateProject(projectId, { status: 'failed', error: e.message });
      throw e;
    }
  }

  async getSplatStream(id: string) {
    const splatPath = path.join(process.cwd(), 'data', id, 'model.splat');
    try {
      await fs.access(splatPath);
      return createReadStream(splatPath);
    } catch (e) {
      // Return null if not found
      return null;
    }
  }

  async getStatus(id: string) {
    const p = this.projectsService.getProject(id);
    if (!p) return null;
    return { status: p.status, progress: p.progress, error: p.error };
  }
}
